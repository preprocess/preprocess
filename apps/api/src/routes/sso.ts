// Single sign-on (spec 13, PRE-137): one SAML or OIDC connection per
// organization, through Better Auth's SSO plugin. Owners only, on plans with
// the sso feature (Enterprise, Internal, or a license that carries it). When
// the plan lapses the connection keeps signing people in and these settings
// turn read-only (spec 16, Expiry). Every change is audited in the same
// transaction as the change.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { ssoProvider, verification } from "@preprocess/db/schema/auth";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { SSO_TOKEN_PREFIX, ssoDomains, withAuth } from "../auth.ts";
import { eventBase } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";
import { getPlan } from "../plan.ts";

const OrgParam = z.object({ org: z.string() });

const Domains = z
  .array(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/,
        "Enter a domain like example.com.",
      ),
  )
  .min(1)
  .max(20);

const Saml = z.object({
  protocol: z.literal("saml"),
  domains: Domains,
  // The IdP's entity id, single sign-on URL and signing certificate, or its
  // metadata XML, which carries all three.
  idpEntityId: z.string().min(1).optional(),
  ssoUrl: z.string().url().optional(),
  certificate: z.string().min(1).optional(),
  metadataXml: z.string().min(1).optional(),
  enforced: z.boolean().optional(),
  jit: z.boolean().optional(),
});

const Oidc = z.object({
  protocol: z.literal("oidc"),
  domains: Domains,
  issuer: z.string().url(),
  clientId: z.string().min(1),
  // Required when the connection is created; left out on an update, the
  // stored secret stays.
  clientSecret: z.string().min(1).optional(),
  enforced: z.boolean().optional(),
  jit: z.boolean().optional(),
});

const ConnectionInput = z
  .discriminatedUnion("protocol", [Saml, Oidc])
  .openapi("SsoConnectionInput");

const Connection = z
  .object({
    protocol: z.enum(["saml", "oidc"]),
    providerId: z.string(),
    issuer: z.string(),
    domains: z.array(z.string()),
    domainVerified: z.boolean(),
    // The TXT record that proves the domains, while they are unverified.
    verification: z.object({ name: z.string(), value: z.string() }).nullable(),
    enforced: z.boolean(),
    jit: z.boolean(),
    // What the IdP needs from us.
    serviceProvider: z.object({
      entityId: z.string().nullable(),
      acsUrl: z.string().nullable(),
      metadataUrl: z.string().nullable(),
      redirectUrl: z.string().nullable(),
    }),
    saml: z
      .object({
        idpEntityId: z.string().nullable(),
        ssoUrl: z.string().nullable(),
        hasCertificate: z.boolean(),
      })
      .nullable(),
    oidc: z.object({ clientId: z.string() }).nullable(),
  })
  .openapi("SsoConnection");

const Settings = z
  .object({
    // Whether the plan includes SSO. Without it the connection still signs
    // people in, and nothing can be changed.
    allowed: z.boolean(),
    connection: Connection.nullable(),
  })
  .openapi("SsoSettings");

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

type Vars = OrgVariables;

const requireOwner = (vars: Vars) => {
  if (vars.caller.type !== "person" || vars.caller.role !== "owner")
    throw new HTTPException(403, {
      message: "Only Owners can manage single sign-on.",
    });
};

const requirePlan = async (env: Env, vars: Vars) => {
  if (!(await getPlan(env, vars.org)).has("sso"))
    throw new HTTPException(403, {
      message: "Single sign-on isn't included in this organization's plan.",
    });
};

// Better Auth's error Responses and APIErrors, as our 4xx.
const authError = (error: unknown): never => {
  const body = (error as { body?: { message?: string; code?: string } }).body;
  const status = (error as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500)
    throw new HTTPException(status as 400, {
      message: body?.message ?? "The SSO connection was refused.",
    });
  throw error;
};

const baseUrl = (env: Env) => new URL("/api/auth", env.APP_URL).toString();
const spEntityId = (env: Env, providerId: string) =>
  `${baseUrl(env)}/sso/saml2/sp/metadata?providerId=${encodeURIComponent(providerId)}`;

const parse = <T>(text: string | null) =>
  text ? (JSON.parse(text) as T) : null;

type StoredSaml = {
  entryPoint?: string;
  cert?: string | string[];
  idpMetadata?: { entityID?: string; metadata?: string; cert?: unknown };
};
type StoredOidc = { clientId: string };

const read = async (env: Env, vars: Vars, headers: Headers) =>
  withAuth(env, vars.request, async (auth, tx) => {
    const [row] = await tx
      .select()
      .from(ssoProvider)
      .where(eq(ssoProvider.organizationId, vars.org));
    if (!row) return null;
    const saml = parse<StoredSaml>(row.samlConfig);
    const oidc = parse<StoredOidc>(row.oidcConfig);
    let record: { name: string; value: string } | null = null;
    if (!row.domainVerified) {
      const identifier = `_${SSO_TOKEN_PREFIX}-${row.providerId}`;
      const [pending] = await tx
        .select({ value: verification.value })
        .from(verification)
        .where(eq(verification.identifier, identifier));
      const token =
        pending?.value ??
        (
          await auth.api.requestDomainVerification({
            body: { providerId: row.providerId },
            headers,
          })
        ).domainVerificationToken;
      record = { name: identifier, value: `${identifier}=${token}` };
    }
    return {
      protocol: saml ? ("saml" as const) : ("oidc" as const),
      providerId: row.providerId,
      issuer: row.issuer,
      domains: ssoDomains(row.domain),
      domainVerified: Boolean(row.domainVerified),
      verification: record,
      enforced: row.enforced,
      jit: row.jit,
      serviceProvider: saml
        ? {
            entityId: spEntityId(env, row.providerId),
            acsUrl: `${baseUrl(env)}/sso/saml2/sp/acs/${row.providerId}`,
            metadataUrl: spEntityId(env, row.providerId),
            redirectUrl: null,
          }
        : {
            entityId: null,
            acsUrl: null,
            metadataUrl: null,
            redirectUrl: `${baseUrl(env)}/sso/callback/${row.providerId}`,
          },
      saml: saml
        ? {
            idpEntityId: saml.idpMetadata?.entityID ?? null,
            ssoUrl: saml.entryPoint ?? null,
            hasCertificate: Boolean(
              saml.cert || saml.idpMetadata?.cert || saml.idpMetadata?.metadata,
            ),
          }
        : null,
      oidc: oidc ? { clientId: oidc.clientId } : null,
    };
  });

const samlConfig = (
  env: Env,
  providerId: string,
  input: z.infer<typeof Saml>,
) => {
  const entityId = spEntityId(env, providerId);
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

export const ssoRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: Vars;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/sso",
      tags: ["Single sign-on"],
      request: { params: OrgParam },
      responses: { 200: json(Settings, "The SSO connection, if any") },
    }),
    async (c) => {
      requireOwner(c.var);
      const allowed = (await getPlan(c.env, c.var.org)).has("sso");
      const connection = await read(c.env, c.var, c.req.raw.headers).catch(
        authError,
      );
      return c.json({ allowed, connection }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/sso",
      tags: ["Single sign-on"],
      request: {
        params: OrgParam,
        body: { content: { "application/json": { schema: ConnectionInput } } },
      },
      responses: {
        200: json(Connection, "The saved connection"),
        403: { description: "Not an Owner, or SSO isn't in the plan" },
      },
    }),
    async (c) => {
      requireOwner(c.var);
      await requirePlan(c.env, c.var);
      const input = c.req.valid("json");
      const providerId = c.var.org;
      const headers = c.req.raw.headers;
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
          throw new HTTPException(409, {
            message:
              "Remove the connection before switching between SAML and OIDC.",
          });
        if (
          input.protocol === "saml" &&
          !input.metadataXml &&
          !(input.idpEntityId && input.ssoUrl && input.certificate)
        )
          throw new HTTPException(400, {
            message:
              "Paste the IdP metadata, or its entity ID, SSO URL and certificate.",
          });
        if (input.protocol === "oidc" && !existing && !input.clientSecret)
          throw new HTTPException(400, { message: "Enter the client secret." });
        const domain = input.domains.join(",");
        const switches = {
          ...(input.enforced === undefined ? {} : { enforced: input.enforced }),
          ...(input.jit === undefined ? {} : { jit: input.jit }),
        };
        const protocolConfig =
          input.protocol === "saml"
            ? { samlConfig: samlConfig(c.env, providerId, input) }
            : {
                oidcConfig: {
                  clientId: input.clientId,
                  ...(input.clientSecret
                    ? { clientSecret: input.clientSecret }
                    : {}),
                },
              };
        const issuer =
          input.protocol === "saml"
            ? spEntityId(c.env, providerId)
            : input.issuer;
        if (existing) {
          await auth.api.updateSSOProvider({
            body: {
              providerId,
              issuer,
              domain,
              ...protocolConfig,
              ...switches,
            },
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
              ...switches,
            },
            headers,
          });
        }
        await audit(tx, {
          ...eventBase(c.var),
          action: existing
            ? "sso.connection.updated"
            : "sso.connection.created",
          targetType: "sso_connection",
          targetId: providerId,
          data: {
            protocol: input.protocol,
            domains: input.domains,
            ...(existing
              ? {
                  from: {
                    domains: ssoDomains(existing.domain),
                    enforced: existing.enforced,
                    jit: existing.jit,
                  },
                }
              : {}),
            enforced: input.enforced ?? existing?.enforced ?? false,
            jit: input.jit ?? existing?.jit ?? true,
          },
        });
      }).catch(authError);
      const connection = await read(c.env, c.var, headers);
      return c.json(connection!, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/sso/verify-domain",
      tags: ["Single sign-on"],
      request: { params: OrgParam },
      responses: {
        200: json(Connection, "The connection with its domains verified"),
        409: { description: "The TXT record wasn't found yet" },
      },
    }),
    async (c) => {
      requireOwner(c.var);
      await requirePlan(c.env, c.var);
      const headers = c.req.raw.headers;
      await withAuth(c.env, c.var.request, async (auth, tx) => {
        const [existing] = await tx
          .select()
          .from(ssoProvider)
          .where(eq(ssoProvider.organizationId, c.var.org));
        if (!existing)
          throw new HTTPException(404, {
            message: "Set up a connection first.",
          });
        if (existing.domainVerified) return;
        try {
          await auth.api.verifyDomain({
            body: { providerId: existing.providerId },
            headers,
          });
        } catch (error) {
          if ((error as { statusCode?: number }).statusCode === 502)
            throw new HTTPException(409, {
              message:
                "We couldn't find the TXT record yet. DNS changes can take a while; try again in a few minutes.",
            });
          throw error;
        }
        await audit(tx, {
          ...eventBase(c.var),
          action: "sso.domain.verified",
          targetType: "sso_connection",
          targetId: existing.providerId,
          data: { domains: ssoDomains(existing.domain) },
        });
      }).catch(authError);
      return c.json((await read(c.env, c.var, headers))!, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/sso",
      tags: ["Single sign-on"],
      request: { params: OrgParam },
      responses: { 204: { description: "Removed" } },
    }),
    async (c) => {
      requireOwner(c.var);
      await requirePlan(c.env, c.var);
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
          data: { domains: ssoDomains(existing.domain) },
        });
      }).catch(authError);
      return c.body(null, 204);
    },
  );
