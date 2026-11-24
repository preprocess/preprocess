"use client";

import { Globe } from "@preprocess/ui/lib/icons";
import { useState, type ReactNode } from "react";

import type {
  AuditLogStreamType,
  ConnectionType,
} from "../workos-client-api/vendor/generated";
import { SettingsIconTile } from "./kit";

const CDN = "https://cdn.workos.com/provider-icons";

const ICON_URL_OVERRIDES: Record<string, { light: string; dark: string }> = {
  "generic-oauth": {
    light:
      "https://images.workoscdn.com/images/0571bf84-5b97-4ef2-93d5-013a5f8657fc.svg",
    dark: "https://images.workoscdn.com/images/3b48c274-7344-4efd-93c0-6fc308040c8e.svg",
  },
  github: {
    light:
      "https://images.workoscdn.com/images/3945fc79-f9db-40d3-8688-eaaee193e583.svg",
    dark: "https://images.workoscdn.com/images/a78955a4-16f5-422a-872f-a06fc7a4212f.svg",
  },
  google: {
    light:
      "https://images.workoscdn.com/images/b6d63052-83dc-4c75-beda-8121ea8bc483.svg",
    dark: "https://images.workoscdn.com/images/ca224b0c-2732-4210-beb1-738a080b4358.svg",
  },
  microsoft: {
    light:
      "https://images.workoscdn.com/images/03c465e5-a6d8-47e2-ab15-1b5f0081fd88.svg",
    dark: "https://images.workoscdn.com/images/86c3df5e-bb56-4bf5-a39e-442c394af17b.svg",
  },
  snowflake: {
    light:
      "https://images.workoscdn.com/images/de5bb010-a1d4-4ed1-8395-099db5149efc.svg",
    dark: "https://images.workoscdn.com/images/de5bb010-a1d4-4ed1-8395-099db5149efc.svg",
  },
  workos: {
    light:
      "https://images.workoscdn.com/images/2577af2e-f6a0-418c-acb5-35f4e7a8a421.svg",
    dark: "https://images.workoscdn.com/images/2577af2e-f6a0-418c-acb5-35f4e7a8a421.svg",
  },
};

const DIRECTORY_TYPE_TO_SLUG: Record<string, string> = {
  "azure scim v2.0": "azure",
  bamboohr: "bamboo-hr",
  "breathe hr": "breathe-hr",
  "cezanne hr": "cezanne-hr",
  "cyberark scim v2.0": "cyberark",
  "fourth hr": "fourth",
  "generic scim v2.0": "workos",
  "gsuite directory": "google",
  hibob: "hibob",
  "jump cloud scim v2.0": "jumpcloud",
  "okta scim v2.0": "okta",
  "onelogin scim v2.0": "onelogin",
  "people hr": "access-people-hr",
  personio: "personio",
  "pingfederate scim v2.0": "ping-identity",
  "rippling scim v2.0": "rippling",
  s3: "aws",
  sftp: "workos",
  "sftp workday": "workday",
  workday: "workday",
  pending: "workos",
};

const DIRECTORY_TYPE_TO_NAME: Record<string, string> = {
  "azure scim v2.0": "Microsoft Entra ID",
  bamboohr: "BambooHR",
  "breathe hr": "Breathe HR",
  "cezanne hr": "Cezanne HR",
  "cyberark scim v2.0": "CyberArk",
  "fourth hr": "Fourth HR",
  "generic scim v2.0": "Generic SCIM",
  "gsuite directory": "Google Workspace",
  hibob: "HiBob",
  "jump cloud scim v2.0": "JumpCloud",
  "okta scim v2.0": "Okta",
  "onelogin scim v2.0": "OneLogin",
  "people hr": "People HR",
  personio: "Personio",
  "pingfederate scim v2.0": "PingFederate",
  "rippling scim v2.0": "Rippling",
  s3: "Amazon S3",
  sftp: "SFTP",
  "sftp workday": "Workday (SFTP)",
  workday: "Workday",
  pending: "Pending",
};

// Provider names and SSO connection types, from the WorkOS widgets
// (lib/identity-providers.ts and the SSO connection widget).
const PROVIDER_NAMES: Record<string, string> = {
  adp: "ADP",
  apple: "Apple",
  auth0: "Auth0",
  azure: "Azure",
  bitbucket: "Bitbucket",
  cas: "CAS",
  classlink: "Classlink",
  clever: "Clever",
  cloudflare: "Cloudflare",
  cyberark: "CyberArk",
  discord: "Discord",
  duo: "Duo",
  "generic-oidc": "Generic OIDC",
  "generic-saml": "Generic SAML",
  github: "GitHub",
  gitlab: "GitLab",
  google: "Google",
  intuit: "Intuit",
  jumpcloud: "JumpCloud",
  keycloak: "Keycloak",
  lastpass: "LastPass",
  linkedin: "LinkedIn",
  "login-gov": "Login.gov",
  microsoft: "Microsoft",
  miniorange: "Miniorange",
  "net-iq": "NetIQ",
  okta: "Okta",
  onelogin: "OneLogin",
  oracle: "Oracle",
  "ping-identity": "Ping Identity",
  rippling: "Rippling",
  salesforce: "Salesforce",
  shibboleth: "Shibboleth",
  "simple-saml-php": "Simple SAML PHP",
  slack: "Slack",
  "test-idp": "Test IDP",
  vercel: "Vercel",
  vmware: "VMware",
  workos: "WorkOS",
  xero: "Xero",
};

const SSO_TYPE_TO_PROVIDER: Record<ConnectionType, string> = {
  ADFSSAML: "microsoft",
  EntraIdOIDC: "microsoft",
  MicrosoftOAuth: "microsoft",
  Auth0Migration: "auth0",
  Auth0SAML: "auth0",
  AzureSAML: "azure",
  CasSAML: "cas",
  ClassLinkSAML: "classlink",
  CloudflareSAML: "cloudflare",
  CyberArkSAML: "cyberark",
  DuoSAML: "duo",
  GenericSAML: "generic-saml",
  GoogleSAML: "google",
  GoogleOIDC: "google",
  GoogleOAuth: "google",
  JumpCloudSAML: "jumpcloud",
  KeycloakSAML: "keycloak",
  LastPassSAML: "lastpass",
  MiniOrangeSAML: "miniorange",
  NetIqSAML: "net-iq",
  OktaOIDC: "okta",
  OktaSAML: "okta",
  OneLoginSAML: "onelogin",
  OracleSAML: "oracle",
  PingFederateSAML: "ping-identity",
  PingOneSAML: "ping-identity",
  RipplingSAML: "rippling",
  SalesforceSAML: "salesforce",
  SalesforceOAuth: "salesforce",
  ShibbolethGenericSAML: "shibboleth",
  ShibbolethSAML: "shibboleth",
  SimpleSamlPhpSAML: "simple-saml-php",
  TestIdp: "test-idp",
  VMwareSAML: "vmware",
  AdpOidc: "adp",
  GenericOIDC: "generic-oidc",
  LoginGovOidc: "login-gov",
  CleverOIDC: "clever",
  AppleOAuth: "apple",
  BitbucketOAuth: "bitbucket",
  DiscordOAuth: "discord",
  GithubOAuth: "github",
  GitLabOAuth: "gitlab",
  IntuitOAuth: "intuit",
  LinkedInOAuth: "linkedin",
  SlackOAuth: "slack",
  VercelOAuth: "vercel",
  VercelMarketplaceOAuth: "vercel",
  XeroOAuth: "xero",
  GrokOAuth: "workos",
  XOAuth: "workos",
  MagicLink: "workos",
};

// Generic SAML and OIDC share the generic sign-in mark.
const PROVIDER_ICON_SLUG: Record<string, string> = {
  "generic-saml": "generic-oauth",
  "generic-oidc": "generic-oauth",
};

const INFERRED_SLUGS: [needle: string, slug: string][] = [
  ["datadog", "datadog"],
  ["splunk", "splunk"],
  ["snowflake", "snowflake"],
  ["rippling", "rippling"],
  ["workday", "workday"],
  ["jumpcloud", "jumpcloud"],
  ["onelogin", "onelogin"],
  ["okta", "okta"],
  ["azure", "azure"],
  ["entra", "azure"],
  ["google", "google"],
  ["microsoft", "microsoft"],
  ["bamboo", "bamboo-hr"],
  ["ping", "ping-identity"],
];

function compactKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function spacedKey(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function inferProviderSlug(value: string) {
  const compact = compactKey(value);
  for (const [needle, slug] of INFERRED_SLUGS) {
    if (compact.includes(needle)) return slug;
  }
  return null;
}

function ssoProvider(type: ConnectionType) {
  return SSO_TYPE_TO_PROVIDER[type] ?? inferProviderSlug(type) ?? "workos";
}

export function ssoProviderSlug(type: ConnectionType) {
  const provider = ssoProvider(type);
  return PROVIDER_ICON_SLUG[provider] ?? provider;
}

export function ssoProviderName(type: ConnectionType) {
  return PROVIDER_NAMES[ssoProvider(type)] ?? type;
}

export function directoryProviderSlug(type: string) {
  return DIRECTORY_TYPE_TO_SLUG[spacedKey(type)] ?? inferProviderSlug(type);
}

export function directoryTypeName(type: string) {
  return DIRECTORY_TYPE_TO_NAME[spacedKey(type)] ?? type;
}

const AUDIT_LOG_DESTINATIONS: Record<
  AuditLogStreamType,
  { name: string; slug: string | null }
> = {
  Datadog: { name: "Datadog", slug: "datadog" },
  Splunk: { name: "Splunk", slug: "splunk" },
  S3: { name: "AWS S3", slug: "aws" },
  GoogleCloudStorage: { name: "Google Cloud Storage", slug: "google-cloud" },
  AzureSentinel: { name: "Azure Sentinel", slug: "azure" },
  Snowflake: { name: "Snowflake", slug: "snowflake" },
  GenericHttps: { name: "Generic HTTPS", slug: null },
};

export function auditLogDestination(type: AuditLogStreamType) {
  return AUDIT_LOG_DESTINATIONS[type] ?? { name: type, slug: null };
}

export function providerIconUrl(slug: string, theme: "light" | "dark") {
  const override = ICON_URL_OVERRIDES[slug];
  if (override) return override[theme];
  return `${CDN}/${theme}/${slug}.svg`;
}

export function ProviderMark({
  slug,
  fallback = <Globe />,
}: {
  slug: string;
  fallback?: ReactNode;
}) {
  // An unknown slug 404s on the CDN; show the fallback glyph instead.
  const [failed, setFailed] = useState(false);
  if (failed) return fallback;
  return (
    <span className="relative block size-4" data-provider={slug}>
      <img
        alt=""
        className="size-4 dark:hidden"
        height={16}
        onError={() => setFailed(true)}
        src={providerIconUrl(slug, "light")}
        width={16}
      />
      <img
        alt=""
        className="hidden size-4 dark:block"
        height={16}
        onError={() => setFailed(true)}
        src={providerIconUrl(slug, "dark")}
        width={16}
      />
    </span>
  );
}

export function SettingsProviderIcon({
  fallback = <Globe />,
  slug,
}: {
  fallback?: ReactNode;
  slug: string | null;
}) {
  return (
    <SettingsIconTile>
      {slug ? <ProviderMark fallback={fallback} slug={slug} /> : fallback}
    </SettingsIconTile>
  );
}
