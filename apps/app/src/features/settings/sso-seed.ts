// The Single sign-on page's types (GET /v1/orgs/{org}/sso) and its seeded
// states, one per Design frame (PRE-137).

import type { ScenarioState } from "../../scenarios/scenarios";

export type SsoTestReason =
  | "audience_mismatch"
  | "signature_invalid"
  | "certificate_expired"
  | "clock_skew"
  | "user_not_assigned"
  | "other";

export type SsoTest =
  | {
      ok: true;
      at: string;
      by: { id: string; name: string };
      email: string;
    }
  | {
      ok: false;
      at: string;
      by: { id: string; name: string };
      reason: SsoTestReason;
      idpMessage: string;
    };

export type SsoDomain = {
  domain: string;
  status: "pending" | "verified" | "failed";
  checkedAt: string | null;
  verifiedAt: string | null;
  failureReason: "record_missing" | "value_mismatch" | "dns_error" | null;
  record: { type: "TXT"; name: string; value: string };
};

export type SsoConnection = {
  protocol: "saml" | "oidc";
  saml: null | {
    metadataUrl: string | null;
    pastedXml: boolean;
    metadataReadAt: string | null;
    certificateExpiresAt: string | null;
    idpEntityId: string | null;
  };
  oidc: null | { issuer: string; clientId: string; hasSecret: boolean };
  lastTest: SsoTest | null;
  requireSso: boolean;
  jit: boolean;
  defaultGroupId: string | null;
};

export type SsoSettings = {
  access: {
    available: boolean;
    reason: "plan" | "license_missing" | "license_expired" | null;
    licenseExpiredAt: string | null;
    canEdit: boolean;
    role: "owner" | "admin";
  };
  serviceProvider: { acsUrl: string; entityId: string; redirectUri: string };
  connection: SsoConnection | null;
  domains: SsoDomain[];
};

export type SsoGroup = { id: string; name: string };

export type SsoSeedState = Exclude<ScenarioState<"sso">, "live">;

const APP = "https://app.preprocess.com";
const ORG = "acme-demo";
const DANA = { id: "user_dana", name: "Dana Whitfield" };

/** Who passes a seeded test sign-in. */
export const SEEDED_TESTER = { by: DANA, email: "dana@acme.com" };

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

export const seedRecord = (domain: string): SsoDomain["record"] => ({
  type: "TXT",
  name: `_preprocess.${domain}`,
  value: "preprocess-verification=k7Pq2dW9xA4mT1",
});

export const SEEDED_GROUPS: SsoGroup[] = [
  { id: "grp_claims", name: "Claims team" },
  { id: "grp_developers", name: "Developers" },
  { id: "grp_operators", name: "Operators" },
];

const OWNER_ACCESS: SsoSettings["access"] = {
  available: true,
  reason: null,
  licenseExpiredAt: null,
  canEdit: true,
  role: "owner",
};

const SERVICE_PROVIDER: SsoSettings["serviceProvider"] = {
  acsUrl: `${APP}/api/auth/sso/saml2/callback/${ORG}`,
  entityId: `${APP}/api/auth/sso/saml2/sp/${ORG}`,
  redirectUri: `${APP}/api/auth/sso/callback/${ORG}`,
};

const PASSED_EARLIER: SsoTest = {
  ok: true,
  at: "2026-11-20T17:42:00.000Z",
  ...SEEDED_TESTER,
};

const SAML: SsoConnection = {
  protocol: "saml",
  saml: {
    metadataUrl: "https://acme.okta.com/app/exk8f2kq1x/sso/saml/metadata",
    pastedXml: false,
    metadataReadAt: "2026-11-20T17:40:00.000Z",
    certificateExpiresAt: "2028-03-14T00:00:00.000Z",
    idpEntityId: "http://www.okta.com/exk8f2kq1x",
  },
  oidc: null,
  lastTest: PASSED_EARLIER,
  requireSso: false,
  jit: true,
  defaultGroupId: "grp_operators",
};

const OIDC: SsoConnection = {
  ...SAML,
  protocol: "oidc",
  saml: null,
  oidc: {
    issuer: "https://acme.okta.com/oauth2/default",
    clientId: "0oa8f2kq1xYH7vZ4d697",
    hasSecret: true,
  },
};

const domains = (): SsoDomain[] => [
  {
    domain: "acme.com",
    status: "verified",
    checkedAt: minutesAgo(2),
    verifiedAt: "2026-11-20T17:50:00.000Z",
    failureReason: null,
    record: seedRecord("acme.com"),
  },
  {
    domain: "acme.co.uk",
    status: "pending",
    checkedAt: minutesAgo(10),
    verifiedAt: null,
    failureReason: null,
    record: seedRecord("acme.co.uk"),
  },
  {
    domain: "acmelabs.io",
    status: "failed",
    checkedAt: minutesAgo(60),
    verifiedAt: null,
    failureReason: "record_missing",
    record: seedRecord("acmelabs.io"),
  },
];

const settings = (
  connection: SsoConnection | null,
  overrides: Partial<SsoSettings> = {},
): SsoSettings => ({
  access: OWNER_ACCESS,
  serviceProvider: SERVICE_PROVIDER,
  connection,
  domains: connection ? domains() : [],
  ...overrides,
});

const unavailable = (
  reason: NonNullable<SsoSettings["access"]["reason"]>,
  licenseExpiredAt: string | null = null,
): SsoSettings["access"] => ({
  available: false,
  reason,
  licenseExpiredAt,
  canEdit: false,
  role: "owner",
});

/**
 * A seeded state's settings. "member" and "error" answer 403 and 500 in
 * sso-api.ts, and "loading" never settles, so they have none here.
 */
export function seededSso(
  state: Exclude<SsoSeedState, "member" | "error" | "loading">,
): SsoSettings {
  switch (state) {
    case "configured":
      return settings(SAML);
    case "oidc":
      return settings(OIDC);
    case "empty":
      return settings(null);
    case "test-passed":
      return settings({
        ...SAML,
        lastTest: { ...PASSED_EARLIER, at: new Date().toISOString() },
      });
    case "test-failed":
      return settings({
        ...SAML,
        lastTest: {
          ok: false,
          at: minutesAgo(1),
          by: DANA,
          reason: "audience_mismatch",
          idpMessage: `Audience mismatch. Expected ${SERVICE_PROVIDER.entityId}`,
        },
      });
    case "required":
      return settings({ ...SAML, requireSso: true });
    case "admin":
      return settings(SAML, {
        access: { ...OWNER_ACCESS, canEdit: false, role: "admin" },
      });
    case "expired":
      return settings(SAML, {
        access: unavailable("license_expired", "2026-11-01T00:00:00.000Z"),
      });
    case "locked":
      return settings(null, { access: unavailable("plan") });
    case "locked-selfhost":
      return settings(null, { access: unavailable("license_missing") });
  }
}
