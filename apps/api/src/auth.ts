// Better Auth, run in our own code (spec 13): passwordless sign-in by
// emailed magic link or Google (when configured), the organization plugin with the fixed roles, and organization-wide API keys.
//
// Every auth request runs inside one Postgres transaction on DB_SYSTEM: the
// Drizzle adapter writes through that transaction, and the hooks below write
// their audit events and Developers group through the same one, so an action
// and its audit event commit together or not at all (doc 02). A response with
// an error status rolls the transaction back.

import { apiKey } from "@better-auth/api-key";
import { sso } from "@better-auth/sso";
import { audit, startAuditChain } from "@preprocess/db/audit";
import { auditEvents } from "@preprocess/db/schema/audit";
import type { AuditInput } from "@preprocess/db/audit";
import { withoutOrg, withoutOrgRead } from "@preprocess/db/client";
import type { SystemTx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import type { IdKind } from "@preprocess/db/ids";
import { groupMembers, groups } from "@preprocess/db/schema/access";
import * as authSchema from "@preprocess/db/schema/auth";
import { ssoDomains as ssoDomainRows } from "@preprocess/db/schema/sso";
import { runMode } from "@preprocess/runmode";
import { betterAuth } from "better-auth";
import { generateRandomString } from "better-auth/crypto";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  bearer,
  deviceAuthorization,
  magicLink,
  organization,
} from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import { and, count, eq, gt, sql } from "drizzle-orm";

import {
  durationBucket,
  personIdentify,
  productEvent,
  type ProductEvent,
} from "@preprocess/logs";

import { identifyOrganizations, track } from "./analytics.ts";
import { endBillingForDeletion } from "./billing.ts";
import { deleteSupportObjects } from "./support.ts";
import { sendInvitationEmail, sendMagicLinkEmail } from "./email.ts";
import type { Env } from "./env.ts";
import { refuseWithoutPlan, SCIM_PATH, scimDirectory } from "./scim.ts";

// The deploy smoke test (infra/scripts/smoke.ts) has no mailbox. On staging
// and previews only, its one address (smoke-test+<stage>@ EMAIL_FROM's
// domain) gets a sign-in token that is an HMAC of that address and the
// current minute under the auth secret, which the smoke test also holds, and
// the token opens for two minutes at most. Every other stage refuses any
// smoke-test address before a token exists or is checked. Its link is never
// mailed, since the smoke test opens it itself.
// The one device-flow client: `preprocess login`.
export const CLI_CLIENT_ID = "preprocess-cli";

const SMOKE_TEST_STAGE = /^(staging|pr-\d+)$/;
const SMOKE_TEST_LOCAL = /^smoke-test\+/i;
const smokeTestToken = async (
  secret: string,
  email: string,
  minute: number,
) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`smoke-test:${email}:${minute}`),
  );
  return [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

// Owner, Admin and Member are Better Auth's own roles. The only addition is
// that Admins manage organization API keys (mvp-surface), which by default
// only the owner may.
const ac = createAccessControl({
  ...defaultStatements,
  apiKey: ["create", "read", "update", "delete"],
});
const all = ["create", "read", "update", "delete"] as const;
const roles = {
  owner: ac.newRole({ ...ownerAc.statements, apiKey: [...all] }),
  admin: ac.newRole({ ...adminAc.statements, apiKey: [...all] }),
  member: ac.newRole({ ...memberAc.statements }),
};

const idKinds: Record<string, IdKind> = {
  user: "user",
  session: "session",
  account: "account",
  verification: "verification",
  organization: "organization",
  member: "member",
  invitation: "invitation",
  apikey: "apikey",
  ssoProvider: "ssoProvider",
};

// Where an SSO sign-in lands: the OIDC callback and the SAML assertion
// consumer, each with the provider in the path.
const SSO_CALLBACK = /^\/sso\/(callback|saml2\/sp\/acs)\//;
// The plugin's management routes. The app manages a connection through
// /v1/orgs/{org}/sso (routes/sso.ts), which checks the plan and the Owner and
// writes the audit event; these HTTP routes are off.
export const SSO_MANAGEMENT_PATHS = [
  "/sso/register",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/providers",
  "/sso/get-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
];
// Better Auth's own domain proof is unused: sso_domains holds each domain's
// TXT record (routes/sso.ts), and the connection the plugin sees lists only
// verified domains and counts as verified.
export const SSO_TOKEN_PREFIX = "preprocess-sso";
// Shown in a connection's domain list while none of its domains is verified,
// so no address reaches it by email. .invalid never resolves (RFC 2606).
export const SSO_NO_DOMAIN = "unverified.invalid";

// A test sign-in (routes/sso.ts): its cookie marks the tester's browser, and
// the identity provider's answer lands on the done page in their popup.
export const SSO_TEST_COOKIE = "preprocess_sso_test";
export const SSO_TEST_DONE = "/api/auth/sso-test/done";
const SSO_TEST_TTL_MS = 15 * 60_000;

export type SsoTestReason =
  | "audience_mismatch"
  | "signature_invalid"
  | "certificate_expired"
  | "clock_skew"
  | "user_not_assigned"
  | "other";
export type SsoTest =
  | { ok: true; at: string; by: { id: string; name: string }; email: string }
  | {
      ok: false;
      at: string;
      by: { id: string; name: string };
      reason: SsoTestReason;
      idpMessage: string;
    };

// Which hint the settings page shows, from what the plugin or the identity
// provider said.
export const ssoTestReason = (message: string): SsoTestReason => {
  if (
    /access_denied|not assigned|requestdenied|unauthorized_client/i.test(
      message,
    )
  )
    return "user_not_assigned";
  if (/audience/i.test(message)) return "audience_mismatch";
  if (/certificate/i.test(message) && /expired|not valid after/i.test(message))
    return "certificate_expired";
  if (/signature|digest/i.test(message)) return "signature_invalid";
  if (
    /notbefore|notonorafter|clock|timestamp|not yet valid|expired/i.test(
      message,
    )
  )
    return "clock_skew";
  return "other";
};

// The SP entity id the connection's SAML app must name as its audience.
export const ssoEntityId = (env: Env, providerId: string) =>
  `${new URL("/api/auth", env.APP_URL).toString()}/sso/saml2/sp/metadata?providerId=${encodeURIComponent(providerId)}`;

// The plugin answers a SAML response it can't parse with only "Invalid SAML
// response". For a test, the response itself says what was wrong often
// enough: a refusal, another audience, or an assertion outside its time.
const diagnoseSaml = (
  xml: string,
  audience: string,
  now: number,
): { reason: SsoTestReason; message: string } | null => {
  const tag = (name: string) =>
    new RegExp(`<(?:\\w+:)?${name}>([^<]+)<`).exec(xml)?.[1]?.trim();
  const status = /<(?:\w+:)?StatusCode[^>]*Value="([^"]+)"/.exec(xml)?.[1];
  if (status && !status.endsWith(":Success"))
    return {
      reason: "user_not_assigned",
      message: tag("StatusMessage") ?? status.split(":").at(-1)!,
    };
  const given = tag("Audience");
  if (given && given !== audience)
    return {
      reason: "audience_mismatch",
      message: `Audience mismatch. Expected ${audience}`,
    };
  const conditions = /<(?:\w+:)?Conditions([^>]*)>/.exec(xml)?.[1] ?? "";
  const notBefore = /NotBefore="([^"]+)"/.exec(conditions)?.[1];
  const notOnOrAfter = /NotOnOrAfter="([^"]+)"/.exec(conditions)?.[1];
  const skew = 5 * 60_000;
  if (
    (notBefore && Date.parse(notBefore) > now + skew) ||
    (notOnOrAfter && Date.parse(notOnOrAfter) < now - skew)
  )
    return {
      reason: "clock_skew",
      message: `The assertion is valid from ${notBefore ?? "any time"} to ${notOnOrAfter ?? "any time"}`,
    };
  return null;
};

// The domains a connection signs in, as stored (comma-separated).
export const ssoDomains = (domain: string) =>
  domain
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

// Who is acting and from where, for the audit events this request writes.
export type RequestContext = {
  ip: string | null;
  requestId: string;
  // The signed-in person, looked up before the handler runs; null on sign-up
  // and sign-in.
  actorId: string | null;
  // An OIDC identity provider this one request may reach (Better Auth only
  // fetches discovery from trusted origins): the issuer an Owner is saving
  // (routes/sso.ts), or the connection an SSO callback names. Never trusted
  // for anything else, so one organization's IdP is no origin of ours.
  idpOrigins: string[];
  // Set while a test sign-in comes back (runSsoTest): the hooks skip the
  // domain and invitation checks and note whom the identity provider signed
  // in, and the whole transaction is rolled back, so nobody is signed in.
  ssoTest: { email: string | null } | null;
};

export const requestContext = (request: Request): RequestContext => ({
  ip: request.headers.get("cf-connecting-ip"),
  requestId: request.headers.get("cf-ray") ?? crypto.randomUUID(),
  actorId: null,
  idpOrigins: [],
  ssoTest: null,
});

// Product events a request's hooks decide, sent once its transaction
// commits (withAuth); a rolled-back request sends none.
const pending = new WeakMap<
  RequestContext,
  { events: ProductEvent[]; organizations: Set<string> }
>();

const pendingFor = (request: RequestContext) => {
  let found = pending.get(request);
  if (!found) {
    found = { events: [], organizations: new Set() };
    pending.set(request, found);
  }
  return found;
};

const signUpMethod = (path: string) =>
  path.startsWith("/scim/v2")
    ? ("directory" as const)
    : SSO_CALLBACK.test(path)
      ? ("sso" as const)
      : path.startsWith("/callback")
        ? ("google" as const)
        : ("email" as const);

export const createAuth = (env: Env, tx: SystemTx, request: RequestContext) => {
  const record = (event: Omit<AuditInput, "ip" | "requestId">) =>
    audit(tx, { ...event, ip: request.ip, requestId: request.requestId });
  // An event to send after commit, and the organization whose group
  // properties (seats) it changed.
  const later = (event: ProductEvent | null, organization?: string) => {
    if (request.ssoTest) return;
    const found = pendingFor(request);
    if (event) found.events.push(event);
    if (organization) found.organizations.add(organization);
  };
  // Better Auth adds the creator as owner (calling afterAddMember) before
  // afterCreateOrganization, when the chain does not exist yet. The
  // organization.created event records that owner instead.
  let creatingOrganization = false;
  let revoking:
    { id: string; referenceId: string; name: string | null } | undefined;
  // Whether the person had a name before /update-user, so naming
  // themselves the first time completes that onboarding step.
  let namedBefore = true;
  const person = (fallback: string) => request.actorId ?? fallback;
  const directory = scimDirectory(env, tx, record, later);

  // Sign-up is open on our cloud. A self-hosted install takes its first
  // person, then only people with a pending invitation.
  const mayJoin = async (email: string) => {
    if (runMode(env).kind === "cloud") return true;
    const [{ users = 0 } = {}] = await tx
      .select({ users: count() })
      .from(authSchema.user);
    if (users === 0) return true;
    return pendingInvitation(email);
  };
  // A first or last name, when set, is set together and spelled out as
  // `name`, which every other reader uses.
  const fullName = (user: Record<string, unknown>) => {
    if (user.firstName === undefined && user.lastName === undefined) return {};
    const first =
      typeof user.firstName === "string" ? user.firstName.trim() : "";
    const last = typeof user.lastName === "string" ? user.lastName.trim() : "";
    if (!first && !last) return { firstName: null, lastName: null };
    if (!first || !last)
      throw new APIError("BAD_REQUEST", {
        message: "Enter your first and last name.",
      });
    return { firstName: first, lastName: last, name: `${first} ${last}` };
  };
  const smokeTestDomain = /@([^>\s]+)>?\s*$/.exec(env.EMAIL_FROM)?.[1];
  const smokeTestAddress =
    SMOKE_TEST_STAGE.test(env.STAGE) && smokeTestDomain
      ? `smoke-test+${env.STAGE}@${smokeTestDomain}`.toLowerCase()
      : null;
  const minuteNow = () => Math.floor(Date.now() / 60_000);
  const notHere = () =>
    new APIError("FORBIDDEN", { message: "This address can't sign in here." });
  const needsInvitation = () =>
    new APIError("FORBIDDEN", {
      message: "Sign-up on this install needs an invitation.",
    });

  const pendingInvitation = async (email: string, organizationId?: string) => {
    const [invited] = await tx
      .select({ id: authSchema.invitation.id })
      .from(authSchema.invitation)
      .where(
        and(
          sql`lower(${authSchema.invitation.email}) = lower(${email})`,
          eq(authSchema.invitation.status, "pending"),
          gt(authSchema.invitation.expiresAt, new Date()),
          organizationId
            ? eq(authSchema.invitation.organizationId, organizationId)
            : undefined,
        ),
      )
      .limit(1);
    return Boolean(invited);
  };
  const ssoConnection = async (providerId: unknown) => {
    if (typeof providerId !== "string") return undefined;
    const [found] = await tx
      .select()
      .from(authSchema.ssoProvider)
      .where(eq(authSchema.ssoProvider.providerId, providerId));
    return found;
  };
  // Whether the address is at one of the organization's verified domains:
  // only those sign in through its connection.
  const atVerifiedDomain = async (
    organizationId: string | null | undefined,
    email: string,
  ) => {
    const domain = email.split("@").at(-1)?.toLowerCase();
    if (!organizationId || !domain) return false;
    const [found] = await tx
      .select({ id: ssoDomainRows.id })
      .from(ssoDomainRows)
      .where(
        and(
          eq(ssoDomainRows.organizationId, organizationId),
          eq(ssoDomainRows.domain, domain),
          eq(ssoDomainRows.status, "verified"),
        ),
      );
    return Boolean(found);
  };
  const domainNotVerified = () =>
    new APIError("FORBIDDEN", {
      code: "SSO_DOMAIN_NOT_VERIFIED",
      message: "Your email's domain isn't verified for single sign-on.",
    });
  // The organization whose verified, enforced connection covers this
  // address, unless the person is one of its Owners: Owners keep every way in
  // so a broken connection can't lock the organization out.
  const ssoRequired = async (email: string) => {
    const domain = email.split("@").at(-1)?.toLowerCase();
    if (!domain) return undefined;
    const enforced = await tx
      .select({
        organizationId: authSchema.ssoProvider.organizationId,
        domain: authSchema.ssoProvider.domain,
      })
      .from(authSchema.ssoProvider)
      .where(
        and(
          eq(authSchema.ssoProvider.enforced, true),
          eq(authSchema.ssoProvider.domainVerified, true),
        ),
      );
    const covering = enforced.find(
      (c) => c.organizationId && ssoDomains(c.domain).includes(domain),
    );
    if (!covering?.organizationId) return undefined;
    const [owner] = await tx
      .select({ id: authSchema.member.id })
      .from(authSchema.member)
      .innerJoin(
        authSchema.user,
        eq(authSchema.user.id, authSchema.member.userId),
      )
      .where(
        and(
          eq(authSchema.member.organizationId, covering.organizationId),
          eq(authSchema.member.role, "owner"),
          sql`lower(${authSchema.user.email}) = lower(${email})`,
        ),
      )
      .limit(1);
    return owner ? undefined : covering.organizationId;
  };
  const useSso = () =>
    new APIError("FORBIDDEN", {
      code: "SSO_REQUIRED",
      message:
        "Your organization signs in with single sign-on. Continue with SSO.",
    });

  return betterAuth({
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: () => [env.APP_URL, ...request.idpOrigins],
    disabledPaths: SSO_MANAGEMENT_PATHS,
    // Native transactions (savepoints in the request's transaction): the
    // SCIM plugin refuses to run without them.
    database: drizzleAdapter(tx, {
      provider: "pg",
      schema: authSchema,
      transaction: true,
    }),
    // No passwords. Both ways in prove the address (the link reaches it, or
    // Google vouches for it), and accepting an invitation needs a verified
    // email, so nobody can take someone else's seat.
    emailAndPassword: { enabled: false },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              // Whatever Google doesn't return, the app asks for after
              // sign-in.
              mapProfileToUser: (profile) => ({
                firstName: profile.given_name || null,
                lastName: profile.family_name || null,
              }),
            },
          }
        : {},
    account: { accountLinking: { trustedProviders: ["google"] } },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      database: {
        generateId: ({ model }) =>
          newId(
            model.startsWith("scim")
              ? "scim"
              : (idKinds[model] ?? "verification"),
          ),
      },
    },
    session: {
      additionalFields: {
        signInMethod: { type: "string", required: false, input: false },
      },
    },
    user: {
      additionalFields: {
        deactivatedAt: { type: "date", required: false, input: false },
        // Entered by the person (sign-up, an invitation, or their profile),
        // never by whoever invited them. `name` follows as "First Last".
        firstName: { type: "string", required: false, input: true },
        lastName: { type: "string", required: false, input: true },
        // Set by the person through update-user (design doc 06).
        emailNotifications: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: true,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          async before(user, ctx) {
            // A directory provisions people without an invitation: its token
            // was issued by an Owner.
            if (ctx?.path?.startsWith("/scim/v2")) {
              return { data: { ...user, ...fullName(user) } };
            }
            // A first SSO sign-in joins through its connection: with JIT on,
            // or an invitation to the connection's organization.
            if (ctx?.path && SSO_CALLBACK.test(ctx.path)) {
              if (request.ssoTest)
                return { data: { ...user, ...fullName(user) } };
              const connection = await ssoConnection(ctx.params?.providerId);
              if (
                !(await atVerifiedDomain(
                  connection?.organizationId,
                  user.email,
                ))
              )
                throw domainNotVerified();
              if (
                !connection?.jit &&
                !(await pendingInvitation(
                  user.email,
                  connection?.organizationId ?? undefined,
                ))
              )
                throw new APIError("FORBIDDEN", {
                  code: "SSO_NOT_INVITED",
                  message:
                    "Ask an Owner of your organization to invite you first.",
                });
            } else if (!(await mayJoin(user.email))) throw needsInvitation();
            return { data: { ...user, ...fullName(user) } };
          },
          after(user, ctx) {
            const method = signUpMethod(ctx?.path ?? "");
            later(
              productEvent(
                env,
                "signed_up",
                null,
                user.id,
                { method },
                {
                  $set_once: {
                    signup_method: method,
                    first_seen: user.createdAt.toISOString(),
                  },
                },
              ),
            );
            return Promise.resolve();
          },
        },
        update: {
          before: (user) =>
            Promise.resolve({ data: { ...user, ...fullName(user) } }),
        },
      },
      session: {
        create: {
          // A deactivated person cannot start a session by any sign-in method
          // (PLAT-27: Better Auth only deletes their sessions).
          async before(session, ctx) {
            const [found] = await tx
              .select({
                deactivatedAt: authSchema.user.deactivatedAt,
                email: authSchema.user.email,
              })
              .from(authSchema.user)
              .where(eq(authSchema.user.id, session.userId));
            if (found?.deactivatedAt)
              throw new APIError("FORBIDDEN", {
                message: "This account is deactivated.",
              });
            // Enforced SSO: only an SSO sign-in starts a session for an
            // address at the domain. `preprocess login` is approved from a
            // session in the app, which already went through SSO.
            const path = ctx?.path ?? "";
            if (SSO_CALLBACK.test(path)) {
              if (request.ssoTest) {
                request.ssoTest.email = found?.email ?? null;
                return;
              }
              const connection = await ssoConnection(ctx?.params?.providerId);
              if (
                !found ||
                !(await atVerifiedDomain(
                  connection?.organizationId,
                  found.email,
                ))
              )
                throw domainNotVerified();
              return { data: { ...session, signInMethod: "sso" } };
            }
            if (
              found &&
              path !== "/device/token" &&
              (await ssoRequired(found.email))
            )
              throw useSso();
          },
          // The session `preprocess login` receives once its code is
          // approved.
          after(session, ctx) {
            if (ctx?.path === "/device/token")
              later(productEvent(env, "cli_login", null, session.userId, {}));
            return Promise.resolve();
          },
        },
      },
    },
    hooks: {
      // The key a revoke names, read before the plugin deletes it, so the
      // audit event can say which organization and key it was.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path?.startsWith("/scim/v2")) {
          await directory.before(ctx);
          return;
        }
        // Refuse a sign-up link up front rather than at the link, so the
        // person sees why on the page instead of after opening the email.
        if (ctx.path === "/magic-link/verify") {
          const token = (ctx.query as { token?: unknown } | undefined)?.token;
          if (typeof token !== "string") return;
          const [row] = await tx
            .select({ value: authSchema.verification.value })
            .from(authSchema.verification)
            .where(
              eq(authSchema.verification.identifier, `magic-link:${token}`),
            )
            .limit(1);
          const email = row
            ? (JSON.parse(row.value) as { email?: unknown }).email
            : undefined;
          if (typeof email !== "string" || !SMOKE_TEST_LOCAL.test(email))
            return;
          if (!smokeTestAddress || email.toLowerCase() !== smokeTestAddress)
            throw notHere();
          const minute = minuteNow();
          const fresh = await Promise.all(
            [minute, minute - 1].map((at) =>
              smokeTestToken(env.BETTER_AUTH_SECRET, smokeTestAddress, at),
            ),
          );
          if (!fresh.includes(token)) throw notHere();
          return;
        }
        if (ctx.path === "/sign-in/magic-link") {
          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          if (typeof email !== "string") return;
          if (
            SMOKE_TEST_LOCAL.test(email) &&
            email.toLowerCase() !== smokeTestAddress
          )
            throw notHere();
          const [known] = await tx
            .select({ id: authSchema.user.id })
            .from(authSchema.user)
            .where(sql`lower(${authSchema.user.email}) = lower(${email})`)
            .limit(1);
          if (!known && !(await mayJoin(email))) throw needsInvitation();
          if (await ssoRequired(email)) throw useSso();
          return;
        }
        if (ctx.path === "/update-user" && request.actorId) {
          const [found] = await tx
            .select({ firstName: authSchema.user.firstName })
            .from(authSchema.user)
            .where(eq(authSchema.user.id, request.actorId));
          namedBefore = Boolean(found?.firstName);
          return;
        }
        if (ctx.path !== "/api-key/delete") return;
        const keyId = (ctx.body as { keyId?: unknown } | undefined)?.keyId;
        if (typeof keyId !== "string") return;
        [revoking] = await tx
          .select({
            id: authSchema.apikey.id,
            referenceId: authSchema.apikey.referenceId,
            name: authSchema.apikey.name,
          })
          .from(authSchema.apikey)
          .where(eq(authSchema.apikey.id, keyId));
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path?.startsWith("/scim/v2")) {
          await directory.after(ctx);
          return;
        }
        const returned = ctx.context.returned as
          | {
              id?: string;
              referenceId?: string;
              name?: string | null;
              success?: boolean;
            }
          | undefined;
        if (!returned || returned instanceof Response || !request.actorId)
          return;
        if (ctx.path === "/api-key/create" && returned.referenceId) {
          await record({
            organizationId: returned.referenceId,
            actorType: "person",
            actorId: request.actorId,
            action: "api_key.created",
            targetType: "api_key",
            targetId: returned.id ?? null,
            data: { name: returned.name ?? null },
          });
          const created = await tx
            .select({ seq: auditEvents.seq })
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.organizationId, returned.referenceId),
                eq(auditEvents.action, "api_key.created"),
              ),
            )
            .limit(2);
          if (returned.id)
            later(
              productEvent(
                env,
                "api_key_created",
                returned.referenceId,
                request.actorId,
                { api_key_id: returned.id, first: created.length === 1 },
              ),
            );
        }
        if (ctx.path === "/api-key/delete" && returned.success && revoking) {
          await record({
            organizationId: revoking.referenceId,
            actorType: "person",
            actorId: request.actorId,
            action: "api_key.revoked",
            targetType: "api_key",
            targetId: revoking.id,
            data: { name: revoking.name },
          });
          later(
            productEvent(
              env,
              "api_key_revoked",
              revoking.referenceId,
              request.actorId,
              { api_key_id: revoking.id },
            ),
          );
        }
        if (ctx.path === "/device/approve" && returned.success)
          later(
            productEvent(env, "device_authorized", null, request.actorId, {}),
          );
        if (ctx.path === "/update-user" && !namedBefore) {
          const [found] = await tx
            .select({ firstName: authSchema.user.firstName })
            .from(authSchema.user)
            .where(eq(authSchema.user.id, request.actorId));
          if (found?.firstName)
            later(
              productEvent(
                env,
                "onboarding_step_completed",
                null,
                request.actorId,
                { step: "name" },
              ),
            );
        }
      }),
    },
    plugins: [
      magicLink({
        expiresIn: 15 * 60,
        generateToken: (email) =>
          smokeTestAddress && email.toLowerCase() === smokeTestAddress
            ? smokeTestToken(
                env.BETTER_AUTH_SECRET,
                smokeTestAddress,
                minuteNow(),
              )
            : generateRandomString(32, "a-z", "A-Z"),
        async sendMagicLink({ email, url }) {
          // The smoke test opens its link itself, so nothing is mailed.
          if (email.toLowerCase() === smokeTestAddress) return;
          await sendMagicLinkEmail(env, { email, url });
        },
      }),
      organization({
        ac,
        roles,
        invitationExpiresIn: 7 * 24 * 60 * 60,
        cancelPendingInvitationsOnReInvite: true,
        schema: {
          organization: {
            additionalFields: {
              createdBy: { type: "string", required: false, input: false },
            },
          },
        },
        async sendInvitationEmail(data) {
          await sendInvitationEmail(env, {
            id: data.id,
            email: data.email,
            organizationName: data.organization.name,
            inviterName: data.inviter.user.name || data.inviter.user.email,
          });
        },
        organizationHooks: {
          beforeCreateOrganization: ({ organization: org, user }) => {
            creatingOrganization = true;
            return Promise.resolve({ data: { ...org, createdBy: user.id } });
          },
          async afterCreateOrganization({ organization: org, user }) {
            await startAuditChain(tx, org.id);
            const developers = newId("group");
            await tx.insert(groups).values({
              id: developers,
              organizationId: org.id,
              slug: "developers",
              name: "Developers",
              description: "Manages every agent.",
              isDevelopers: true,
            });
            await record({
              organizationId: org.id,
              actorType: "person",
              actorId: user.id,
              action: "organization.created",
              targetType: "organization",
              targetId: org.id,
              data: {
                name: org.name,
                slug: org.slug,
                owner: user.id,
                developersGroup: developers,
              },
            });
            later(
              productEvent(
                env,
                "org_created",
                org.id,
                user.id,
                {},
                { $set: { role: "owner" } },
              ),
              org.id,
            );
            // Better Auth has added the creator as owner by now, so one
            // membership is this one.
            const [{ memberships = 0 } = {}] = await tx
              .select({ memberships: count() })
              .from(authSchema.member)
              .where(eq(authSchema.member.userId, user.id));
            if (memberships === 1)
              later(
                productEvent(
                  env,
                  "onboarding_step_completed",
                  org.id,
                  user.id,
                  { step: "organization" },
                ),
              );
          },
          async afterUpdateOrganization({ organization: org, user }) {
            if (!org) return;
            await record({
              organizationId: org.id,
              actorType: "person",
              actorId: user.id,
              action: "organization.updated",
              targetType: "organization",
              targetId: org.id,
              data: { name: org.name, slug: org.slug },
            });
          },
          async beforeDeleteOrganization({ organization: org, user }) {
            try {
              await endBillingForDeletion(env, org.id);
            } catch (error) {
              console.error("billing: deleting organization", org.id, error);
              throw new APIError("SERVICE_UNAVAILABLE", {
                message:
                  "This organization's plan couldn't be closed, so nothing was deleted. Try again in a few minutes.",
              });
            }
            await record({
              organizationId: org.id,
              actorType: "person",
              actorId: user.id,
              action: "organization.deleted",
              targetType: "organization",
              targetId: org.id,
            });
            await tx.execute(sql`
              insert into deleted_organizations (organization_id, deleted_at, final_seq, final_hash)
              select organization_id, now(), seq, hash from audit_heads where organization_id = ${org.id}`);
            later(productEvent(env, "org_deleted", org.id, user.id, {}));
          },
          // Its support rows go by cascade; their attachments' objects here.
          async afterDeleteOrganization({ organization: org }) {
            await deleteSupportObjects(env, org.id);
          },
          async afterAcceptInvitation({ invitation, member, user }) {
            await record({
              organizationId: member.organizationId,
              actorType: "person",
              actorId: user.id,
              action: "member.added",
              targetType: "user",
              targetId: user.id,
              data: { role: member.role, invitation: invitation.id },
            });
            const role = member.role as "member";
            later(
              productEvent(
                env,
                "member_joined",
                member.organizationId,
                user.id,
                { member_user_id: user.id, role, via: "invitation" },
                { $set: { role } },
              ),
              member.organizationId,
            );
            const waited = Math.max(
              0,
              Date.now() - new Date(invitation.createdAt).getTime(),
            );
            later(
              productEvent(
                env,
                "invitation_accepted",
                member.organizationId,
                user.id,
                {
                  invitation_id: invitation.id,
                  role,
                  seconds_to_accept: Math.floor(waited / 1000),
                  accept_wait: durationBucket(waited),
                },
              ),
            );
          },
          async afterAddMember({ member, user }) {
            if (creatingOrganization) return;
            await record({
              organizationId: member.organizationId,
              actorType: request.actorId ? "person" : "platform",
              actorId: request.actorId ?? "platform:auth",
              action: "member.added",
              targetType: "user",
              targetId: user.id,
              data: { role: member.role },
            });
            later(
              productEvent(
                env,
                "member_joined",
                member.organizationId,
                user.id,
                {
                  member_user_id: user.id,
                  role: member.role as "member",
                  via: request.actorId ? "added" : "provisioned",
                },
                { $set: { role: member.role as "member" } },
              ),
              member.organizationId,
            );
          },
          async afterUpdateMemberRole({ member, previousRole }) {
            await record({
              organizationId: member.organizationId,
              actorType: "person",
              actorId: person(member.userId),
              action: "member.role.changed",
              targetType: "user",
              targetId: member.userId,
              data: { from: previousRole, to: member.role },
            });
            later(
              productEvent(
                env,
                "role_changed",
                member.organizationId,
                request.actorId,
                {
                  member_user_id: member.userId,
                  from: previousRole as "member",
                  to: member.role as "member",
                },
              ),
              member.organizationId,
            );
            later(
              personIdentify(member.userId, { role: member.role as "member" }),
            );
          },
          async afterRemoveMember({ member }) {
            later(
              productEvent(
                env,
                "member_removed",
                member.organizationId,
                request.actorId,
                {
                  member_user_id: member.userId,
                  role: member.role as "member",
                  via: request.actorId === member.userId ? "left" : "removed",
                },
              ),
              member.organizationId,
            );
            await record({
              organizationId: member.organizationId,
              actorType: "person",
              actorId: person(member.userId),
              action: "member.removed",
              targetType: "user",
              targetId: member.userId,
            });
          },
          async afterCreateInvitation({ invitation, inviter }) {
            await record({
              organizationId: invitation.organizationId,
              actorType: "person",
              actorId: inviter.id,
              action: "invitation.created",
              targetType: "invitation",
              targetId: invitation.id,
              data: { role: invitation.role },
            });
            later(
              productEvent(
                env,
                "member_invited",
                invitation.organizationId,
                inviter.id,
                {
                  invitation_id: invitation.id,
                  role: invitation.role as "member",
                },
              ),
            );
          },
          async afterCancelInvitation({ invitation, cancelledBy }) {
            await record({
              organizationId: invitation.organizationId,
              actorType: "person",
              actorId: cancelledBy.id,
              action: "invitation.canceled",
              targetType: "invitation",
              targetId: invitation.id,
            });
          },
          async afterRejectInvitation({ invitation, user }) {
            await record({
              organizationId: invitation.organizationId,
              actorType: "person",
              actorId: user.id,
              action: "invitation.rejected",
              targetType: "invitation",
              targetId: invitation.id,
            });
          },
        },
      }),
      apiKey([
        {
          configId: "default",
          defaultPrefix: "pp_",
          references: "organization",
          enableMetadata: true,
          // The plugin's default is 10 requests per key per day, which a CLI
          // or integration exhausts in minutes.
          rateLimit: { enabled: false },
        },
      ]),
      // `preprocess login` (RFC 8628): the CLI asks for a code, the person
      // approves it in the app at /device, and the CLI gets a session of its
      // own that it sends as a bearer token. It acts as that person, with
      // their role, never with an API key's Admin rights.
      deviceAuthorization({
        verificationUri: new URL("/device", env.APP_URL).toString(),
        validateClient: (clientId) => clientId === CLI_CLIENT_ID,
        expiresIn: "15m",
        interval: "5s",
      }),
      bearer(),
      sso({
        domainVerification: { enabled: true, tokenPrefix: SSO_TOKEN_PREFIX },
        // Joining the organization is ours (provisionUser below), so it is
        // audited and follows the connection's JIT switch.
        organizationProvisioning: { disabled: true },
        provisionUserOnEveryLogin: true,
        saml: { requireTimestamps: true },
        schema: {
          ssoProvider: {
            additionalFields: {
              enforced: {
                type: "boolean",
                required: false,
                defaultValue: false,
                input: true,
              },
              jit: {
                type: "boolean",
                required: false,
                defaultValue: true,
                input: true,
              },
              metadataUrl: { type: "string", required: false, input: false },
              metadataReadAt: { type: "date", required: false, input: false },
              certificateExpiresAt: {
                type: "date",
                required: false,
                input: false,
              },
              defaultGroupId: {
                type: "string",
                required: false,
                input: false,
              },
              testId: { type: "string", required: false, input: false },
              testStartedBy: { type: "string", required: false, input: false },
              testStartedAt: { type: "date", required: false, input: false },
              lastTest: { type: "string", required: false, input: false },
            },
          },
        },
        async provisionUser({ user, provider }) {
          const connection = await ssoConnection(provider.providerId);
          const organizationId = connection?.organizationId;
          if (!organizationId || !connection.jit) return;
          const [already] = await tx
            .select({ id: authSchema.member.id })
            .from(authSchema.member)
            .where(
              and(
                eq(authSchema.member.organizationId, organizationId),
                eq(authSchema.member.userId, user.id),
              ),
            );
          // An invitation keeps its own role: the person accepts it.
          if (already || (await pendingInvitation(user.email, organizationId)))
            return;
          await tx.insert(authSchema.member).values({
            id: newId("member"),
            organizationId,
            userId: user.id,
            role: "member",
            createdAt: new Date(),
          });
          await record({
            organizationId,
            actorType: "platform",
            actorId: "platform:sso",
            action: "member.added",
            targetType: "user",
            targetId: user.id,
            data: { role: "member", via: "sso", provider: provider.providerId },
          });
          later(
            productEvent(
              env,
              "member_joined",
              organizationId,
              user.id,
              { member_user_id: user.id, role: "member", via: "provisioned" },
              { $set: { role: "member" } },
            ),
            organizationId,
          );
          // A default group that has since been deleted adds nobody.
          if (!connection.defaultGroupId) return;
          const [group] = await tx
            .select({ id: groups.id, slug: groups.slug })
            .from(groups)
            .where(
              and(
                eq(groups.organizationId, organizationId),
                eq(groups.id, connection.defaultGroupId),
              ),
            );
          if (!group) return;
          await tx
            .insert(groupMembers)
            .values({ organizationId, groupId: group.id, userId: user.id })
            .onConflictDoNothing();
          await record({
            organizationId,
            actorType: "platform",
            actorId: "platform:sso",
            action: "group.member.added",
            targetType: "group",
            targetId: group.id,
            data: { group: group.slug, user: user.id, via: "sso" },
          });
        },
      }),
      directory.plugin,
    ],
  });
};

export type Auth = ReturnType<typeof createAuth>;

class Rollback extends Error {
  constructor(readonly response: Response) {
    super("auth request failed");
  }
}

// Runs one Better Auth call in its own DB_SYSTEM transaction. `fn` returning
// an error Response, or throwing, rolls everything back.
export const withAuth = async <T>(
  env: Env,
  request: RequestContext,
  fn: (auth: Auth, tx: SystemTx) => Promise<T>,
): Promise<T> => {
  try {
    const result = await withoutOrg(env, "better-auth", async (tx) => {
      const result = await fn(createAuth(env, tx, request), tx);
      if (result instanceof Response && result.status >= 400)
        throw new Rollback(result);
      return result;
    });
    const decided = pending.get(request);
    pending.delete(request);
    if (decided) {
      await track(env, decided.events);
      await identifyOrganizations(env, [...decided.organizations]);
    }
    return result;
  } catch (error) {
    pending.delete(request);
    if (error instanceof Rollback) return error.response as T;
    throw error;
  }
};

// Resolves the session outside a transaction: reading it is a few selects,
// and refreshing it is a single update.
export const readSession = (env: Env, request: Request) =>
  withoutOrgRead(env, "better-auth", (tx) =>
    createAuth(env, tx, requestContext(request)).api.getSession({
      headers: request.headers,
    }),
  );

const readCookie = (request: Request, name: string) =>
  request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1) || null;

// Where a test sign-in's popup lands: it tells the settings page to read the
// result and closes. It also clears the test cookie.
const ssoTestDone = () =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Single sign-on</title><script>window.opener?.postMessage({ type: "preprocess:sso-test" }, location.origin); window.close();</script>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": `${SSO_TEST_COOKIE}=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=None`,
      },
    },
  );

class TestAnswered extends Error {
  constructor(readonly answer: { email: string | null; message: string }) {
    super("sso test answered");
  }
}

// What the identity provider's answer came to: the plugin redirects to the
// done page, with ?error= when it refused the answer.
const testAnswer = async (
  env: Env,
  response: Response,
  email: string | null,
) => {
  const location = response.headers.get("location");
  const params = location ? new URL(location, env.APP_URL).searchParams : null;
  const error = [params?.get("error"), params?.get("error_description")]
    .filter(Boolean)
    .join(": ");
  if (!error && email && response.status < 400) return { email, message: "" };
  if (error) return { email: null, message: error };
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { message?: string } | null;
  return {
    email: null,
    message:
      body?.message ?? `The sign-in ended with status ${response.status}.`,
  };
};

// An Owner's test sign-in coming back from the identity provider (started by
// GET /v1/orgs/{org}/sso/test, which set the cookie). The plugin checks the
// answer as for any sign-in, inside a transaction that is then rolled back,
// so the test signs nobody in and adds nobody. The result is stored on the
// connection and audited. Null when the cookie names no test in flight, and
// the request is an ordinary sign-in.
const runSsoTest = async (
  env: Env,
  request: Request,
  context: RequestContext,
  providerId: string,
  testId: string,
): Promise<Response | null> => {
  const [connection] = await withoutOrgRead(env, "better-auth", (tx) =>
    tx
      .select()
      .from(authSchema.ssoProvider)
      .where(eq(authSchema.ssoProvider.providerId, providerId)),
  );
  if (
    !connection?.organizationId ||
    connection.testId !== testId ||
    !connection.testStartedBy ||
    !connection.testStartedAt ||
    Date.now() - connection.testStartedAt.getTime() > SSO_TEST_TTL_MS
  )
    return null;
  if (connection.oidcConfig)
    context.idpOrigins = [new URL(connection.issuer).origin];
  const test = { email: null as string | null };
  context.ssoTest = test;
  const samlXml = connection.samlConfig
    ? await request
        .clone()
        .formData()
        .then((form) => {
          const answer = form.get("SAMLResponse");
          return typeof answer === "string" ? atob(answer) : "";
        })
        .catch(() => "")
    : "";
  // Throwing the answer out of the transaction is what rolls it back.
  const answer = await withoutOrg(env, "better-auth", async (tx) => {
    const response = await createAuth(env, tx, context).handler(request);
    throw new TestAnswered(await testAnswer(env, response, test.email));
  }).catch((error: unknown) =>
    error instanceof TestAnswered
      ? error.answer
      : { email: null, message: (error as Error).message },
  );
  const organizationId = connection.organizationId;
  const testerId = connection.testStartedBy;
  await withoutOrg(env, "better-auth", async (tx) => {
    const [tester] = await tx
      .select({ name: authSchema.user.name, email: authSchema.user.email })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, testerId));
    const by = { id: testerId, name: tester?.name || tester?.email || "" };
    const at = new Date().toISOString();
    const reason = ssoTestReason(answer.message);
    const diagnosed =
      !answer.email && reason === "other" && samlXml
        ? diagnoseSaml(samlXml, ssoEntityId(env, providerId), Date.now())
        : null;
    const certificateExpired =
      connection.certificateExpiresAt &&
      connection.certificateExpiresAt.getTime() < Date.now();
    const result: SsoTest = answer.email
      ? { ok: true, at, by, email: answer.email }
      : diagnosed
        ? {
            ok: false,
            at,
            by,
            reason: diagnosed.reason,
            idpMessage: diagnosed.message,
          }
        : reason === "other" && certificateExpired
          ? {
              ok: false,
              at,
              by,
              reason: "certificate_expired",
              idpMessage: `The signing certificate expired on ${connection.certificateExpiresAt!.toISOString().slice(0, 10)}`,
            }
          : { ok: false, at, by, reason, idpMessage: answer.message };
    const stored = await tx
      .update(authSchema.ssoProvider)
      .set({ lastTest: JSON.stringify(result), testId: null })
      .where(
        and(
          eq(authSchema.ssoProvider.providerId, providerId),
          eq(authSchema.ssoProvider.testId, testId),
        ),
      )
      .returning({ id: authSchema.ssoProvider.id });
    if (!stored.length) return;
    await audit(tx, {
      organizationId,
      actorType: "person",
      actorId: testerId,
      action: result.ok ? "sso.test.passed" : "sso.test.failed",
      targetType: "sso_connection",
      targetId: providerId,
      data: result.ok ? { email: result.email } : { reason: result.reason },
      ip: context.ip,
      requestId: context.requestId,
    });
  });
  return ssoTestDone();
};

// Better Auth's own routes (/api/auth/*), with the signed-in person resolved
// first so hooks can name who acted. Reading the session names nobody, so it
// skips both the transaction and the second lookup.
export const handleAuthRequest = async (env: Env, request: Request) => {
  const context = requestContext(request);
  const { pathname } = new URL(request.url);
  // SCIM (scim.ts) authenticates by its own bearer token, never a session.
  if (pathname.startsWith(`${SCIM_PATH}/`))
    return (
      (await refuseWithoutPlan(env, request)) ??
      withAuth(env, context, (auth) => auth.handler(request))
    );
  if (request.method === "GET" && pathname === "/api/auth/get-session")
    return withoutOrgRead(env, "better-auth", (tx) =>
      createAuth(env, tx, context).handler(request),
    );
  if (pathname === SSO_TEST_DONE) return ssoTestDone();
  const landing =
    /^\/api\/auth\/sso\/(?:callback|saml2\/sp\/acs)\/([^/]+)$/.exec(pathname);
  const testId = landing ? readCookie(request, SSO_TEST_COOKIE) : null;
  if (landing && testId) {
    const tested = await runSsoTest(
      env,
      request,
      context,
      decodeURIComponent(landing[1]!),
      testId,
    );
    if (tested) return tested;
  }
  return withAuth(env, context, async (auth, tx) => {
    const session = await auth.api.getSession({ headers: request.headers });
    context.actorId = session?.user.id ?? null;
    const callback = /^\/api\/auth\/sso\/callback\/([^/]+)$/.exec(
      new URL(request.url).pathname,
    );
    if (callback) {
      const [connection] = await tx
        .select({ issuer: authSchema.ssoProvider.issuer })
        .from(authSchema.ssoProvider)
        .where(
          eq(
            authSchema.ssoProvider.providerId,
            decodeURIComponent(callback[1]!),
          ),
        );
      if (connection) context.idpOrigins = [new URL(connection.issuer).origin];
    }
    return auth.handler(request);
  });
};
