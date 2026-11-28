// Single sign-on (spec 13, PRE-137): one SAML or OIDC connection per
// organization through Better Auth's SSO plugin, the email domains that sign
// in through it, a test sign-in, Require SSO and JIT provisioning. Owners and
// Admins read the settings; only Owners change them, and only while the plan
// or license includes SSO. When it lapses (a cloud plan without SSO, or a
// self-hosted license past its grace) the connection keeps signing people in
// and these settings are read-only (spec 16, Expiry). Every change is audited
// in the same transaction as the change.

import { X509Certificate } from "node:crypto";
import { resolveTxt } from "node:dns/promises";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withoutOrg } from "@preprocess/db/client";
import type { SystemTx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { groups } from "@preprocess/db/schema/access";
import { member, session, ssoProvider, user } from "@preprocess/db/schema/auth";
import { ssoDomains } from "@preprocess/db/schema/sso";
import type { SsoDomainFailure } from "@preprocess/db/schema/sso";
import { runMode } from "@preprocess/runmode";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import {
  SSO_NO_DOMAIN,
  SSO_TEST_COOKIE,
  SSO_TEST_DONE,
  ssoEntityId,
  withAuth,
} from "../auth.ts";
import type { SsoTest } from "../auth.ts";
import { eventBase } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Env } from "../env.ts";
import { getPlan } from "../plan.ts";

const OrgParam = z.object({ org: z.string() });
const DomainParam = z.object({ org: z.string(), domain: z.string() });

const MAX_DOMAINS = 20;
// DNS changes can take up to a day to appear (the record dialog says so): a
// record not found yet leaves a new domain pending for that long.
const PENDING_MS = 24 * 60 * 60_000;
const RECORD_NAME = "_preprocess";
const RECORD_VALUE = "preprocess-verification=";

const https = z
  .string()
  .trim()
  .url("Use an https:// URL.")
  .refine((value) => value.startsWith("https://"), "Use an https:// URL.");

const Saml = z.object({
  protocol: z.literal("saml"),
  // The IdP's metadata, read from its URL or pasted, or its entity id, single
  // sign-on URL and signing certificate.
  metadataUrl: https.optional(),
  metadataXml: z.string().trim().min(1).optional(),
  idpEntityId: z.string().min(1).optional(),
  ssoUrl: z.string().url().optional(),
  certificate: z.string().min(1).optional(),
});

const Oidc = z.object({
  protocol: z.literal("oidc"),
  issuer: https,
  clientId: z.string().trim().min(1),
  // Required when the connection is created; left out on an update, the
  // stored secret stays.
  clientSecret: z.string().min(1).optional(),
});

const ConnectionInput = z
  .discriminatedUnion("protocol", [Saml, Oidc])
  .openapi("SsoConnectionInput");

const SignInInput = z
  .object({
    requireSso: z.boolean().optional(),
    jit: z.boolean().optional(),
    defaultGroupId: z.string().nullable().optional(),
  })
  .strict()
  .openapi("SsoSignInInput");

const DomainInput = z
  .object({
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/,
        "Enter a domain like acme.com.",
      ),
  })
  .strict()
  .openapi("SsoDomainInput");

const By = z.object({ id: z.string(), name: z.string() });
const TestResult = z
  .discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      at: z.string(),
      by: By,
      email: z.string(),
    }),
    z.object({
      ok: z.literal(false),
      at: z.string(),
      by: By,
      reason: z.enum([
        "audience_mismatch",
        "signature_invalid",
        "certificate_expired",
        "clock_skew",
        "user_not_assigned",
        "other",
      ]),
      idpMessage: z.string(),
    }),
  ])
  .openapi("SsoTestResult");

const Domain = z
  .object({
    domain: z.string(),
    status: z.enum(["pending", "verified", "failed"]),
    checkedAt: z.string().nullable(),
    verifiedAt: z.string().nullable(),
    failureReason: z
      .enum(["record_missing", "value_mismatch", "dns_error"])
      .nullable(),
    record: z.object({
      type: z.literal("TXT"),
      name: z.string(),
      value: z.string(),
    }),
  })
  .openapi("SsoDomain");

const Settings = z
  .object({
    access: z.object({
      available: z.boolean(),
      reason: z
        .enum(["plan", "license_missing", "license_expired"])
        .nullable()
        .openapi({
          description:
            "Why SSO isn't available: plan (our cloud, a plan without SSO), license_missing (self-hosted, the key doesn't include it), license_expired (self-hosted, past the license's grace: sign-in keeps working, settings are read-only)",
        }),
      licenseExpiredAt: z.string().nullable().openapi({
        description:
          "With license_expired: when paid features turned off (the end of the license's grace)",
      }),
      canEdit: z.boolean(),
      role: z.enum(["owner", "admin"]),
    }),
    // What the identity provider needs from us, for this organization.
    serviceProvider: z.object({
      acsUrl: z.string(),
      entityId: z.string(),
      redirectUri: z.string(),
    }),
    connection: z
      .object({
        protocol: z.enum(["saml", "oidc"]),
        saml: z
          .object({
            metadataUrl: z.string().nullable(),
            pastedXml: z.boolean(),
            metadataReadAt: z.string().nullable(),
            certificateExpiresAt: z.string().nullable(),
            idpEntityId: z.string().nullable(),
          })
          .nullable(),
        oidc: z
          .object({
            issuer: z.string(),
            clientId: z.string(),
            hasSecret: z.boolean(),
          })
          .nullable(),
        lastTest: TestResult.nullable(),
        requireSso: z.boolean(),
        jit: z.boolean(),
        defaultGroupId: z.string().nullable(),
      })
      .nullable(),
    domains: z.array(Domain),
  })
  .openapi("SsoSettings");

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

type Vars = OrgVariables;
type Access = z.infer<typeof Settings>["access"];

const access = async (env: Env, vars: Vars): Promise<Access> => {
  const role = vars.caller.role;
  if (role !== "owner" && role !== "admin")
    throw new HTTPException(403, {
      message: "Only Owners and Admins can see single sign-on.",
    });
  const plan = await getPlan(env, vars.org);
  if (plan.has("sso"))
    return {
      available: true,
      reason: null,
      licenseExpiredAt: null,
      canEdit: vars.caller.type === "person" && role === "owner",
      role,
    };
  const cloud = runMode(env).kind === "cloud";
  const license = plan.license;
  const expired =
    !cloud &&
    license?.status === "expired" &&
    license.license.features.includes("sso")
      ? license.license
      : null;
  return {
    available: false,
    reason: cloud ? "plan" : expired ? "license_expired" : "license_missing",
    licenseExpiredAt: expired?.graceEndsAt.toISOString() ?? null,
    canEdit: false,
    role,
  };
};

// Only Owners change single sign-on, and only while it's available; the
// user id of the Owner.
const requireEditor = async (env: Env, vars: Vars) => {
  if (vars.caller.type !== "person" || vars.caller.role !== "owner")
    throw new HTTPException(403, {
      message: "Only Owners can change single sign-on.",
    });
  if (!(await access(env, vars)).available)
    throw new HTTPException(403, {
      message: "Single sign-on isn't included in this organization's plan.",
    });
  return vars.caller.userId;
};

// Better Auth's error Responses and APIErrors, as our 4xx.
const authError = (error: unknown): never => {
  if (error instanceof HTTPException) throw error;
  const body = (error as { body?: { message?: string; code?: string } }).body;
  const status = (error as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500)
    throw new HTTPException(status as 400, {
      message: body?.message ?? "The SSO connection was refused.",
    });
  throw error;
};

const baseUrl = (env: Env) => new URL("/api/auth", env.APP_URL).toString();
const serviceProvider = (env: Env, providerId: string) => ({
  acsUrl: `${baseUrl(env)}/sso/saml2/sp/acs/${providerId}`,
  entityId: ssoEntityId(env, providerId),
  redirectUri: `${baseUrl(env)}/sso/callback/${providerId}`,
});

const parse = <T>(text: string | null | undefined) =>
  text ? (JSON.parse(text) as T) : null;

type StoredSaml = { idpMetadata?: { entityID?: string; metadata?: string } };
type StoredOidc = { clientId: string; clientSecret?: string };
type DomainRow = typeof ssoDomains.$inferSelect;

const record = (row: DomainRow) => ({
  type: "TXT" as const,
  name: `${RECORD_NAME}.${row.domain}`,
  value: `${RECORD_VALUE}${row.token}`,
});

const domainView = (row: DomainRow) => ({
  domain: row.domain,
  status: row.status,
  checkedAt: row.checkedAt?.toISOString() ?? null,
  verifiedAt: row.verifiedAt?.toISOString() ?? null,
  failureReason: row.status === "failed" ? row.failureReason : null,
  record: record(row),
});

const read = async (env: Env, vars: Vars) => {
  const granted = await access(env, vars);
  return withoutOrg(env, "sso", async (tx) => {
    const [row] = await tx
      .select({ provider: ssoProvider, defaultGroup: groups.id })
      .from(ssoProvider)
      .leftJoin(
        groups,
        and(
          eq(groups.id, ssoProvider.defaultGroupId),
          eq(groups.organizationId, vars.org),
        ),
      )
      .where(eq(ssoProvider.organizationId, vars.org));
    const domains = await tx
      .select()
      .from(ssoDomains)
      .where(eq(ssoDomains.organizationId, vars.org))
      .orderBy(asc(ssoDomains.createdAt));
    const provider = row?.provider;
    const saml = parse<StoredSaml>(provider?.samlConfig);
    const oidc = parse<StoredOidc>(provider?.oidcConfig);
    return {
      access: granted,
      serviceProvider: serviceProvider(env, vars.org),
      connection: provider
        ? {
            protocol: saml ? ("saml" as const) : ("oidc" as const),
            saml: saml
              ? {
                  metadataUrl: provider.metadataUrl,
                  pastedXml:
                    !provider.metadataUrl &&
                    Boolean(saml.idpMetadata?.metadata),
                  metadataReadAt:
                    provider.metadataReadAt?.toISOString() ?? null,
                  certificateExpiresAt:
                    provider.certificateExpiresAt?.toISOString() ?? null,
                  idpEntityId: saml.idpMetadata?.entityID ?? null,
                }
              : null,
            oidc: oidc
              ? {
                  issuer: provider.issuer,
                  clientId: oidc.clientId,
                  hasSecret: Boolean(oidc.clientSecret),
                }
              : null,
            lastTest: parse<SsoTest>(provider.lastTest),
            requireSso: provider.enforced,
            jit: provider.jit,
            defaultGroupId: row.defaultGroup,
          }
        : null,
      domains: domains.map(domainView),
    };
  });
};

const verifiedDomains = async (tx: SystemTx, org: string) =>
  (
    await tx
      .select({ domain: ssoDomains.domain })
      .from(ssoDomains)
      .where(
        and(
          eq(ssoDomains.organizationId, org),
          eq(ssoDomains.status, "verified"),
        ),
      )
      .orderBy(asc(ssoDomains.createdAt))
  ).map((d) => d.domain);

// The plugin's view of the connection: only verified domains route sign-in
// to it, and it counts as verified (auth.ts decides which addresses may sign
// in). Without a verified domain Require SSO can't hold, so it turns off;
// true when it did.
const syncConnection = async (tx: SystemTx, org: string) => {
  const verified = await verifiedDomains(tx, org);
  const [before] = await tx
    .select({ enforced: ssoProvider.enforced })
    .from(ssoProvider)
    .where(eq(ssoProvider.organizationId, org));
  if (!before) return false;
  const turnOff = before.enforced && verified.length === 0;
  await tx
    .update(ssoProvider)
    .set({
      domain: verified.join(",") || SSO_NO_DOMAIN,
      domainVerified: true,
      ...(turnOff ? { enforced: false } : {}),
    })
    .where(eq(ssoProvider.organizationId, org));
  return turnOff;
};

const unreadable = (status: string) =>
  new ApiError(
    400,
    "metadata_unreadable",
    `Couldn't read the metadata: the URL returned ${status}.`,
    { status },
  );

// The identity provider's metadata or discovery document.
const fetchText = async (url: string) => {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/xml, application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw unreadable("no response");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw unreadable(`${response.status} ${response.statusText}`.trim());
  }
  return response.text();
};

const certificateExpiry = (certificate: string | undefined) => {
  if (!certificate) return null;
  const pem = certificate.includes("-----BEGIN")
    ? certificate
    : `-----BEGIN CERTIFICATE-----\n${certificate.replace(/\s+/g, "")}\n-----END CERTIFICATE-----`;
  try {
    return new Date(new X509Certificate(pem).validTo);
  } catch {
    return null;
  }
};

const samlConfig = (
  env: Env,
  providerId: string,
  input: z.infer<typeof Saml>,
) => {
  const entityId = ssoEntityId(env, providerId);
  return {
    entryPoint: input.ssoUrl,
    cert: input.certificate,
    audience: entityId,
    callbackUrl: "/",
    idpMetadata: input.metadataXml
      ? { metadata: input.metadataXml, entityID: input.idpEntityId }
      : {
          entityID: input.idpEntityId,
          ...(input.ssoUrl
            ? {
                singleSignOnService: [
                  {
                    Binding:
                      "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
                    Location: input.ssoUrl,
                  },
                ],
              }
            : {}),
        },
    spMetadata: { entityID: entityId },
    wantAssertionsSigned: true,
  };
};

// What a TXT lookup found: null when the record proves the domain.
const lookup = async (row: DomainRow): Promise<SsoDomainFailure | null> => {
  const { name, value } = record(row);
  let records: string[];
  try {
    records = (await resolveTxt(name)).map((parts) => parts.join("").trim());
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA"
      ? "record_missing"
      : "dns_error";
  }
  if (records.includes(value)) return null;
  return records.some((r) => r.startsWith(RECORD_VALUE))
    ? "value_mismatch"
    : "record_missing";
};

const taken = () =>
  new ApiError(
    409,
    "domain_taken",
    "Another organization has already verified this domain.",
  );

// A verified domain belongs to one organization (sso_domains_verified).
const uniqueAsTaken = (error: unknown): never => {
  const code =
    (error as { code?: string }).code ??
    (error as { cause?: { code?: string } }).cause?.code;
  if (code === "23505") throw taken();
  throw error;
};

// Checks a domain's TXT record and stores what it found. A verified domain
// stays verified.
const check = async (tx: SystemTx, vars: Vars, row: DomainRow) => {
  const failure = await lookup(row);
  const now = new Date();
  if (failure || row.status === "verified") {
    const waiting =
      failure === "record_missing" &&
      now.getTime() - row.createdAt.getTime() < PENDING_MS;
    const status =
      row.status === "verified" ? "verified" : waiting ? "pending" : "failed";
    const [updated] = await tx
      .update(ssoDomains)
      .set({
        status,
        failureReason: status === "failed" ? failure : null,
        checkedAt: now,
      })
      .where(eq(ssoDomains.id, row.id))
      .returning();
    return updated!;
  }
  const [elsewhere] = await tx
    .select({ id: ssoDomains.id })
    .from(ssoDomains)
    .where(
      and(
        eq(ssoDomains.domain, row.domain),
        eq(ssoDomains.status, "verified"),
        ne(ssoDomains.organizationId, vars.org),
      ),
    );
  if (elsewhere) throw taken();
  const [updated] = await tx
    .update(ssoDomains)
    .set({
      status: "verified",
      failureReason: null,
      checkedAt: now,
      verifiedAt: now,
    })
    .where(eq(ssoDomains.id, row.id))
    .returning();
  await syncConnection(tx, vars.org);
  await audit(tx, {
    ...eventBase(vars),
    action: "sso.domain.verified",
    targetType: "sso_domain",
    targetId: row.id,
    data: { domain: row.domain },
  });
  return updated!;
};

const findDomain = async (tx: SystemTx, org: string, domain: string) => {
  const [row] = await tx
    .select()
    .from(ssoDomains)
    .where(
      and(
        eq(ssoDomains.organizationId, org),
        eq(ssoDomains.domain, domain.toLowerCase()),
      ),
    );
  if (!row)
    throw new ApiError(404, "not_found", "That domain isn't on the list.");
  return row;
};

// Turning Require SSO on ends every session at the verified domains that
// didn't come through SSO, except the organization's Owners' (they keep
// email-link sign-in).
const endOtherSessions = async (tx: SystemTx, org: string) => {
  const domains = await verifiedDomains(tx, org);
  if (!domains.length) return 0;
  const ended = await tx
    .delete(session)
    .where(
      sql`${session.signInMethod} is distinct from 'sso'
        and ${session.userId} in (
          select ${user.id} from ${user}
          where lower(split_part(${user.email}, '@', 2)) in (${sql.join(
            domains.map((d) => sql`${d}`),
            sql`, `,
          )})
          and not exists (
            select 1 from ${member}
            where ${member.organizationId} = ${org}
              and ${member.userId} = ${user.id}
              and ${member.role} = 'owner'
          )
        )`,
    )
    .returning({ id: session.id });
  return ended.length;
};

export const ssoRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: Vars;
}>({
  defaultHook: (result, c) => {
    if (!result.success)
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: result.error.issues.map((i) => i.message).join("; "),
          },
        },
        400,
      );
  },
})
  .openapi(
    createRoute({
      method: "get",
      path: "/sso",
      tags: ["Single sign-on"],
      summary: "Single sign-on settings (Owners and Admins)",
      request: { params: OrgParam },
      responses: {
        200: json(
          Settings,
          "The connection, its domains, and who may change them",
        ),
        403: { description: "Members can't see single sign-on" },
      },
    }),
    async (c) => c.json(await read(c.env, c.var), 200),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/sso",
      tags: ["Single sign-on"],
      summary: "Create or change the connection (Owner)",
      description:
        "SAML takes the identity provider's metadata URL (read now), its metadata XML, or its entity ID, SSO URL and certificate. OIDC reads the issuer's discovery document now. A change clears the last test sign-in.",
      request: {
        params: OrgParam,
        body: { content: { "application/json": { schema: ConnectionInput } } },
      },
      responses: {
        200: json(Settings, "The settings with the saved connection"),
        400: { description: "Invalid, or the metadata couldn't be read" },
        403: { description: "Not an Owner, or SSO isn't available" },
        409: { description: "Switching between SAML and OIDC" },
      },
    }),
    async (c) => {
      await requireEditor(c.env, c.var);
      const given = c.req.valid("json");
      const providerId = c.var.org;
      const headers = c.req.raw.headers;
      let input = given;
      let metadataUrl: string | null = null;
      let metadataReadAt: Date | null = null;
      if (input.protocol === "saml") {
        if (input.metadataUrl) {
          metadataUrl = input.metadataUrl;
          input = { ...input, metadataXml: await fetchText(metadataUrl) };
        }
        if (input.metadataXml) {
          if (!/EntityDescriptor/.test(input.metadataXml))
            throw new ApiError(
              400,
              "metadata_invalid",
              "That isn't SAML metadata.",
            );
          metadataReadAt = new Date();
          const services = [
            ...input.metadataXml.matchAll(
              /<(?:\w+:)?SingleSignOnService\b[^>]*>/g,
            ),
          ].map(([element]) => ({
            binding: /Binding="([^"]+)"/.exec(element)?.[1] ?? "",
            location: /Location="([^"]+)"/.exec(element)?.[1],
          }));
          input = {
            ...input,
            idpEntityId:
              input.idpEntityId ??
              /entityID="([^"]+)"/.exec(input.metadataXml)?.[1],
            ssoUrl:
              input.ssoUrl ??
              (
                services.find((s) => s.binding.endsWith("HTTP-Redirect")) ??
                services[0]
              )?.location,
          };
        }
      } else
        await fetchText(
          `${input.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
        );
      const certificate =
        input.protocol === "saml"
          ? (input.certificate ??
            /<(?:\w+:)?X509Certificate>([^<]+)</.exec(
              input.metadataXml ?? "",
            )?.[1])
          : undefined;
      const request = {
        ...c.var.request,
        idpOrigins:
          input.protocol === "oidc" ? [new URL(input.issuer).origin] : [],
      };
      await withAuth(c.env, request, async (auth, tx) => {
        const [existing] = await tx
          .select()
          .from(ssoProvider)
          .where(eq(ssoProvider.organizationId, c.var.org));
        if (
          existing &&
          Boolean(existing.samlConfig) !== (input.protocol === "saml")
        )
          throw new ApiError(
            409,
            "protocol_change",
            "Remove the connection before switching between SAML and OIDC.",
          );
        if (
          input.protocol === "saml" &&
          !input.metadataXml &&
          !(input.idpEntityId && input.ssoUrl && input.certificate)
        )
          throw new ApiError(
            400,
            "invalid_request",
            "Paste the IdP metadata, or its entity ID, SSO URL and certificate.",
          );
        if (input.protocol === "oidc" && !existing && !input.clientSecret)
          throw new ApiError(
            400,
            "invalid_request",
            "Enter the client secret.",
          );
        const domain =
          (await verifiedDomains(tx, c.var.org)).join(",") || SSO_NO_DOMAIN;
        const protocolConfig =
          input.protocol === "saml"
            ? { samlConfig: samlConfig(c.env, providerId, input) }
            : {
                oidcConfig: {
                  clientId: input.clientId,
                  clientSecret:
                    input.clientSecret ??
                    parse<StoredOidc>(existing?.oidcConfig)?.clientSecret,
                },
              };
        const issuer =
          input.protocol === "saml"
            ? ssoEntityId(c.env, providerId)
            : input.issuer;
        if (existing) {
          await auth.api.updateSSOProvider({
            body: { providerId, issuer, domain, ...protocolConfig },
            headers,
          });
        } else {
          await auth.api.registerSSOProvider({
            body: {
              providerId,
              organizationId: c.var.org,
              issuer,
              domain,
              ...(protocolConfig as {
                samlConfig: ReturnType<typeof samlConfig>;
              }),
            },
            headers,
          });
        }
        await tx
          .update(ssoProvider)
          .set({
            domain,
            domainVerified: true,
            metadataUrl,
            metadataReadAt,
            certificateExpiresAt: certificateExpiry(certificate),
            lastTest: null,
            testId: null,
          })
          .where(eq(ssoProvider.organizationId, c.var.org));
        await audit(tx, {
          ...eventBase(c.var),
          action: existing
            ? "sso.connection.updated"
            : "sso.connection.created",
          targetType: "sso_connection",
          targetId: providerId,
          data:
            input.protocol === "oidc"
              ? {
                  protocol: "oidc",
                  issuer: input.issuer,
                  clientId: input.clientId,
                  secretChanged: Boolean(input.clientSecret),
                }
              : {
                  protocol: "saml",
                  metadataUrl,
                  idpEntityId: input.idpEntityId ?? null,
                },
        });
      }).catch(authError);
      return c.json(await read(c.env, c.var), 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/sso",
      tags: ["Single sign-on"],
      summary: "Remove the connection (Owner)",
      description:
        "People sign in with an email link instead, and Require SSO turns off with it. The domains stay.",
      request: { params: OrgParam },
      responses: { 204: { description: "Removed" } },
    }),
    async (c) => {
      await requireEditor(c.env, c.var);
      await withAuth(c.env, c.var.request, async (auth, tx) => {
        const [existing] = await tx
          .select()
          .from(ssoProvider)
          .where(eq(ssoProvider.organizationId, c.var.org));
        if (!existing) return;
        await auth.api.deleteSSOProvider({
          body: { providerId: existing.providerId },
          headers: c.req.raw.headers,
        });
        await audit(tx, {
          ...eventBase(c.var),
          action: "sso.connection.deleted",
          targetType: "sso_connection",
          targetId: existing.providerId,
          data: { requireSso: existing.enforced },
        });
      }).catch(authError);
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/sso/test",
      tags: ["Single sign-on"],
      summary: "Start a test sign-in (Owner)",
      description: `Opened in a popup: redirects to the identity provider. Its answer is checked as for any sign-in but signs nobody in; the popup then lands on ${SSO_TEST_DONE}, which posts { type: "preprocess:sso-test" } to its opener, and the result is the connection's lastTest.`,
      request: { params: OrgParam },
      responses: {
        302: { description: "To the identity provider" },
        404: { description: "No connection" },
      },
    }),
    async (c) => {
      const tester = await requireEditor(c.env, c.var);
      const testId = crypto.randomUUID();
      const request = { ...c.var.request };
      const started = await withAuth(c.env, request, async (auth, tx) => {
        const [existing] = await tx
          .select()
          .from(ssoProvider)
          .where(eq(ssoProvider.organizationId, c.var.org));
        if (!existing)
          throw new ApiError(404, "not_found", "Connect a provider first.");
        if (existing.oidcConfig)
          request.idpOrigins = [new URL(existing.issuer).origin];
        await tx
          .update(ssoProvider)
          .set({ testId, testStartedBy: tester, testStartedAt: new Date() })
          .where(eq(ssoProvider.id, existing.id));
        return auth.api.signInSSO({
          body: {
            providerId: existing.providerId,
            callbackURL: SSO_TEST_DONE,
            errorCallbackURL: SSO_TEST_DONE,
          },
          headers: c.req.raw.headers,
          returnHeaders: true,
        });
      }).catch(authError);
      const response = c.redirect(started.response.url, 302);
      for (const cookie of started.headers.getSetCookie())
        response.headers.append("set-cookie", cookie);
      response.headers.append(
        "set-cookie",
        `${SSO_TEST_COOKIE}=${testId}; Path=/api/auth; Max-Age=900; HttpOnly; Secure; SameSite=None`,
      );
      return response;
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/sso/sign-in",
      tags: ["Single sign-on"],
      summary: "Require SSO, JIT provisioning and the default group (Owner)",
      description:
        "Turning Require SSO on needs a verified domain and a passed last test sign-in, and ends every session at the verified domains that didn't come through SSO, except Owners', who keep email-link sign-in. Turning it off applies at once.",
      request: {
        params: OrgParam,
        body: { content: { "application/json": { schema: SignInInput } } },
      },
      responses: {
        200: json(Settings, "The settings"),
        404: { description: "No connection" },
        409: { description: "Not ready to require SSO" },
      },
    }),
    async (c) => {
      await requireEditor(c.env, c.var);
      const input = c.req.valid("json");
      await withoutOrg(c.env, "sso", async (tx) => {
        const [existing] = await tx
          .select()
          .from(ssoProvider)
          .where(eq(ssoProvider.organizationId, c.var.org));
        if (!existing)
          throw new ApiError(404, "not_found", "Connect a provider first.");
        const turningOn = input.requireSso === true && !existing.enforced;
        if (
          turningOn &&
          (!(await verifiedDomains(tx, c.var.org)).length ||
            !parse<SsoTest>(existing.lastTest)?.ok)
        )
          throw new ApiError(
            409,
            "sso_not_ready",
            "Verify a domain and pass a test sign-in first.",
          );
        if (input.defaultGroupId) {
          const [group] = await tx
            .select({ id: groups.id })
            .from(groups)
            .where(
              and(
                eq(groups.organizationId, c.var.org),
                eq(groups.id, input.defaultGroupId),
              ),
            );
          if (!group)
            throw new ApiError(
              400,
              "invalid_request",
              "That group doesn't exist.",
            );
        }
        const next = {
          enforced: input.requireSso ?? existing.enforced,
          jit: input.jit ?? existing.jit,
          defaultGroupId:
            input.defaultGroupId === undefined
              ? existing.defaultGroupId
              : input.defaultGroupId,
        };
        await tx
          .update(ssoProvider)
          .set(next)
          .where(eq(ssoProvider.id, existing.id));
        const endedSessions = turningOn
          ? await endOtherSessions(tx, c.var.org)
          : 0;
        await audit(tx, {
          ...eventBase(c.var),
          action: "sso.sign_in.updated",
          targetType: "sso_connection",
          targetId: existing.providerId,
          data: {
            from: {
              requireSso: existing.enforced,
              jit: existing.jit,
              defaultGroupId: existing.defaultGroupId,
            },
            to: {
              requireSso: next.enforced,
              jit: next.jit,
              defaultGroupId: next.defaultGroupId,
            },
            ...(turningOn ? { endedSessions } : {}),
          },
        });
      });
      return c.json(await read(c.env, c.var), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/sso/domains",
      tags: ["Single sign-on"],
      summary: "Add an email domain (Owner)",
      description:
        "Checks its TXT record at once, so a domain whose record is already published comes back verified.",
      request: {
        params: OrgParam,
        body: { content: { "application/json": { schema: DomainInput } } },
      },
      responses: {
        201: json(Domain, "The domain and the TXT record that proves it"),
        409: {
          description:
            "Already on the list, or verified by another organization",
        },
      },
    }),
    async (c) => {
      const owner = await requireEditor(c.env, c.var);
      const { domain } = c.req.valid("json");
      const added = await withoutOrg(c.env, "sso", async (tx) => {
        const existing = await tx
          .select({
            organizationId: ssoDomains.organizationId,
            status: ssoDomains.status,
          })
          .from(ssoDomains)
          .where(eq(ssoDomains.domain, domain));
        if (existing.some((d) => d.organizationId === c.var.org))
          throw new ApiError(
            409,
            "domain_exists",
            "That domain is already on the list.",
          );
        if (existing.some((d) => d.status === "verified")) throw taken();
        const [{ count = 0 } = {}] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(ssoDomains)
          .where(eq(ssoDomains.organizationId, c.var.org));
        if (count >= MAX_DOMAINS)
          throw new ApiError(
            400,
            "invalid_request",
            `An organization can have up to ${MAX_DOMAINS} domains.`,
          );
        const [row] = await tx
          .insert(ssoDomains)
          .values({
            id: newId("ssoDomain"),
            organizationId: c.var.org,
            domain,
            token: crypto.randomUUID().replaceAll("-", ""),
            createdBy: owner,
          })
          .returning();
        await audit(tx, {
          ...eventBase(c.var),
          action: "sso.domain.added",
          targetType: "sso_domain",
          targetId: row!.id,
          data: { domain },
        });
        return check(tx, c.var, row!);
      }).catch(uniqueAsTaken);
      return c.json(domainView(added), 201);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/sso/domains/{domain}/check",
      tags: ["Single sign-on"],
      summary: "Check a domain's TXT record now (Owner)",
      description:
        "Verified when the record is found. Not found yet, a domain stays pending for a day after it was added, then fails; a different value or a DNS error fails at once. A verified domain stays verified: nothing re-checks it.",
      request: { params: DomainParam },
      responses: {
        200: json(Domain, "The domain after the check"),
        404: { description: "Not on the list" },
        409: { description: "Verified by another organization" },
      },
    }),
    async (c) => {
      await requireEditor(c.env, c.var);
      const { domain } = c.req.valid("param");
      const checked = await withoutOrg(c.env, "sso", async (tx) =>
        check(tx, c.var, await findDomain(tx, c.var.org, domain)),
      ).catch(uniqueAsTaken);
      return c.json(domainView(checked), 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/sso/domains/{domain}",
      tags: ["Single sign-on"],
      summary: "Remove a domain (Owner)",
      description:
        "People at it sign in with an email link again. Removing the last verified domain turns Require SSO off.",
      request: { params: DomainParam },
      responses: { 204: { description: "Removed" } },
    }),
    async (c) => {
      await requireEditor(c.env, c.var);
      const { domain } = c.req.valid("param");
      await withoutOrg(c.env, "sso", async (tx) => {
        const row = await findDomain(tx, c.var.org, domain);
        await tx.delete(ssoDomains).where(eq(ssoDomains.id, row.id));
        const requireSsoOff = await syncConnection(tx, c.var.org);
        await audit(tx, {
          ...eventBase(c.var),
          action: "sso.domain.removed",
          targetType: "sso_domain",
          targetId: row.id,
          data: { domain: row.domain, status: row.status, requireSsoOff },
        });
      });
      return c.body(null, 204);
    },
  );
