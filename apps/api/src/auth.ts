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
import type { AuditInput } from "@preprocess/db/audit";
import { withoutOrg, withoutOrgRead } from "@preprocess/db/client";
import type { SystemTx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import type { IdKind } from "@preprocess/db/ids";
import { groups } from "@preprocess/db/schema/access";
import * as authSchema from "@preprocess/db/schema/auth";
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

import { endBillingForDeletion } from "./billing.ts";
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
// The DNS TXT record that proves a domain: _preprocess-sso-<provider>.<domain>.
export const SSO_TOKEN_PREFIX = "preprocess-sso";

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
};

export const requestContext = (request: Request): RequestContext => ({
  ip: request.headers.get("cf-connecting-ip"),
  requestId: request.headers.get("cf-ray") ?? crypto.randomUUID(),
  actorId: null,
  idpOrigins: [],
});

export const createAuth = (env: Env, tx: SystemTx, request: RequestContext) => {
  const record = (event: Omit<AuditInput, "ip" | "requestId">) =>
    audit(tx, { ...event, ip: request.ip, requestId: request.requestId });
  // Better Auth adds the creator as owner (calling afterAddMember) before
  // afterCreateOrganization, when the chain does not exist yet. The
  // organization.created event records that owner instead.
  let creatingOrganization = false;
  let revoking:
    { id: string; referenceId: string; name: string | null } | undefined;
  const person = (fallback: string) => request.actorId ?? fallback;
  const directory = scimDirectory(env, tx, record);

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
              const connection = await ssoConnection(ctx.params?.providerId);
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
            if (
              found &&
              !SSO_CALLBACK.test(path) &&
              path !== "/device/token" &&
              (await ssoRequired(found.email))
            )
              throw useSso();
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
        if (ctx.path === "/api-key/create" && returned.referenceId)
          await record({
            organizationId: returned.referenceId,
            actorType: "person",
            actorId: request.actorId,
            action: "api_key.created",
            targetType: "api_key",
            targetId: returned.id ?? null,
            data: { name: returned.name ?? null },
          });
        if (ctx.path === "/api-key/delete" && returned.success && revoking)
          await record({
            organizationId: revoking.referenceId,
            actorType: "person",
            actorId: request.actorId,
            action: "api_key.revoked",
            targetType: "api_key",
            targetId: revoking.id,
            data: { name: revoking.name },
          });
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
          },
          async afterRemoveMember({ member }) {
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
    return await withoutOrg(env, "better-auth", async (tx) => {
      const result = await fn(createAuth(env, tx, request), tx);
      if (result instanceof Response && result.status >= 400)
        throw new Rollback(result);
      return result;
    });
  } catch (error) {
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

// Better Auth's own routes (/api/auth/*), with the signed-in person resolved
// first so hooks can name who acted. Reading the session names nobody, so it
// skips both the transaction and the second lookup.
export const handleAuthRequest = async (env: Env, request: Request) => {
  const context = requestContext(request);
  // SCIM (scim.ts) authenticates by its own bearer token, never a session.
  if (new URL(request.url).pathname.startsWith(`${SCIM_PATH}/`))
    return (
      (await refuseWithoutPlan(env, request)) ??
      withAuth(env, context, (auth) => auth.handler(request))
    );
  if (
    request.method === "GET" &&
    new URL(request.url).pathname === "/api/auth/get-session"
  )
    return withoutOrgRead(env, "better-auth", (tx) =>
      createAuth(env, tx, context).handler(request),
    );
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
