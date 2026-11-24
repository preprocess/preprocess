// Vendored from @workos-inc/widgets 1.20.2 (MIT, Copyright (c) 2024 WorkOS),
// src/api/client-graphql/generated.ts. Do not edit; re-vendor to update.
import type { GraphQLClient, RequestOptions } from "graphql-request";
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<
  T extends { [key: string]: unknown },
  K extends keyof T,
> = { [_ in K]?: never };
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never;
    };
type GraphQLClientRequestHeaders = RequestOptions["requestHeaders"];
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  /** A date-time string at UTC, such as 2019-12-03T09:54:33Z, compliant with the date-time format. */
  DateTime: { input: string; output: string };
  /** The `JSON` scalar type represents JSON values as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf). */
  JSON: { input: any; output: any };
};

/** A short-lived link that starts an Admin Portal session for the token’s organization, scoped to a single setup flow. */
export type AdminPortalLink = {
  __typename?: "AdminPortalLink";
  /** When the link stops being redeemable. */
  expiresAt: Scalars["DateTime"]["output"];
  /** The setup flow the link is scoped to. */
  intent: AdminPortalLinkIntent;
  /** The Admin Portal URL to send the user to. It carries a bearer capability, so treat it as a secret and redirect immediately. */
  link: Scalars["String"]["output"];
};

/** The Admin Portal setup flow a link is scoped to. */
export type AdminPortalLinkIntent =
  "DomainVerification" | "Dsync" | "LogStreams" | "Sso";

/** All other sessions were revoked successfully. */
export type AllSessionsRevoked = {
  __typename?: "AllSessionsRevoked";
  success: Scalars["Boolean"]["output"];
};

/** The key is already expired, so its expiration cannot change. */
export type ApiKeyAlreadyExpired = {
  __typename?: "ApiKeyAlreadyExpired";
  apiKeyId: Scalars["ID"]["output"];
};

/** The kind of API key a permission may be granted to. */
export type ApiKeyOwnerType =
  /** Organization API keys, created with `createOrganizationApiKey`. */
  | "Organization"
  /** User API keys, created with `createUserApiKey`. */
  | "User";

/** One or more requested permission slugs are not held by the caller. A key never carries more than the caller minting it holds, so the caller must be granted a permission before it can grant it to a key. */
export type ApiKeyPermissionsNotHeld = {
  __typename?: "ApiKeyPermissionsNotHeld";
  message: Scalars["String"]["output"];
  /** The requested permission slugs the caller does not hold. */
  unheldPermissions: Array<Scalars["String"]["output"]>;
};

/** The token cannot grant permissions to a key. The caller is not acting as a member of the organization, so there is no set of held permissions to bound the key to; such a token can only create a key with no permissions. */
export type ApiKeyPermissionsUnsupportedForToken = {
  __typename?: "ApiKeyPermissionsUnsupportedForToken";
  message: Scalars["String"]["output"];
  /** The permission slugs that were requested for the key. */
  requestedPermissions: Array<Scalars["String"]["output"]>;
};

export type AssignPermissionToRoleInput = {
  /** The slug of the permission to assign. */
  permissionSlug: Scalars["String"]["input"];
  /** The ID of the role to assign the permission to. */
  roleId: Scalars["ID"]["input"];
};

export type AuditEvent = {
  __typename?: "AuditEvent";
  action: Scalars["String"]["output"];
  actor: AuditEventActor;
  createdAt: Scalars["DateTime"]["output"];
  data: Scalars["JSON"]["output"];
  id: Scalars["ID"]["output"];
  occurredAt: Scalars["DateTime"]["output"];
  targets: Array<Scalars["String"]["output"]>;
  updatedAt: Scalars["DateTime"]["output"];
};

export type AuditEventActor = {
  __typename?: "AuditEventActor";
  id: Scalars["String"]["output"];
  name?: Maybe<Scalars["String"]["output"]>;
  type: Scalars["String"]["output"];
};

export type AuditEventFilterInput = {
  actions?: InputMaybe<Array<Scalars["String"]["input"]>>;
  actorIds?: InputMaybe<Array<Scalars["String"]["input"]>>;
  actorNames?: InputMaybe<Array<Scalars["String"]["input"]>>;
  rangeEnd: Scalars["DateTime"]["input"];
  rangeStart: Scalars["DateTime"]["input"];
  search?: InputMaybe<Scalars["String"]["input"]>;
  targetIds?: InputMaybe<Array<Scalars["String"]["input"]>>;
  targetTypes?: InputMaybe<Array<Scalars["String"]["input"]>>;
};

export type AuditEventList = {
  __typename?: "AuditEventList";
  data: Array<AuditEvent>;
  listMetadata: ListMetadata;
};

export type AuditLogExport = {
  __typename?: "AuditLogExport";
  createdAt: Scalars["DateTime"]["output"];
  id: Scalars["ID"]["output"];
  state: AuditLogExportState;
  updatedAt: Scalars["DateTime"]["output"];
  /** A signed URL to the CSV file. Only defined once the export is ready. */
  url?: Maybe<Scalars["String"]["output"]>;
};

export type AuditLogExportState = "Error" | "Expired" | "Pending" | "Ready";

/** The audit log stream destination configured for the token's organization. Exposes status metadata only; destination settings and credentials are never included. */
export type AuditLogStream = {
  __typename?: "AuditLogStream";
  auditLogTrailId: Scalars["ID"]["output"];
  /** The most recent delivery error message, if any. */
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  /** The ID of the last audit log event delivered to the stream. */
  lastSyncedEventId?: Maybe<Scalars["String"]["output"]>;
  state: AuditLogStreamState;
  type: AuditLogStreamType;
};

/** The delivery state of an audit log stream. */
export type AuditLogStreamState = "Active" | "Error" | "Inactive" | "Invalid";

/** The destination provider audit log events are streamed to. */
export type AuditLogStreamType =
  | "AzureSentinel"
  | "Datadog"
  | "GenericHttps"
  | "GoogleCloudStorage"
  | "S3"
  | "Snowflake"
  | "Splunk";

/** AuthKit settings for the token's environment. */
export type AuthKitSettings = {
  __typename?: "AuthKitSettings";
  /** The HTTPS origin of the preferred AuthKit domain. */
  origin: Scalars["String"]["output"];
};

/** The authentication methods the environment allows, and the password policy it enforces. Distinct from what the authenticated user has set up, which lives on `me`. */
export type AuthenticationSettings = {
  __typename?: "AuthenticationSettings";
  /** Whether multi-factor authentication is available in this environment. When `false`, TOTP enrollment should not be offered. */
  mfaEnabled: Scalars["Boolean"]["output"];
  /** Whether multi-factor authentication is mandatory for every user in this environment. */
  mfaRequired: Scalars["Boolean"]["output"];
  /** Whether users may authenticate with a passkey. */
  passkeyAuthEnabled: Scalars["Boolean"]["output"];
  /** Whether users may authenticate with a password. When `false`, `createPassword` and `updatePassword` should not be offered. */
  passwordAuthEnabled: Scalars["Boolean"]["output"];
  passwordPolicy: PasswordPolicy;
};

/** The branding the token renders: its application's own once that application has been customized, otherwise its environment's. */
export type Branding = {
  __typename?: "Branding";
  /** The product name shown to users. */
  displayName: Scalars["String"]["output"];
  /** The fully resolved dark-mode icon URL, or null when it is not configured. */
  logoDarkIconPath?: Maybe<Scalars["String"]["output"]>;
  /** The fully resolved dark-mode logo URL, or null when it is not configured. */
  logoDarkPath?: Maybe<Scalars["String"]["output"]>;
  /** The fully resolved light-mode icon URL, or null when it is not configured. */
  logoLightIconPath?: Maybe<Scalars["String"]["output"]>;
  /** The fully resolved light-mode logo URL, or null when it is not configured. */
  logoLightPath?: Maybe<Scalars["String"]["output"]>;
};

/** A data provider members connect individually, with the token's organization's configuration of it. */
export type ConfigurableDataProvider = {
  __typename?: "ConfigurableDataProvider";
  /** How accounts authenticate with this data provider. */
  authMethods: Array<Scalars["String"]["output"]>;
  /** Every scope the organization may request. Only populated for providers where the organization brings its own OAuth credentials; empty otherwise. */
  availableScopes: Array<Scalars["String"]["output"]>;
  /** The non-secret configuration values pinned for the token's organization. */
  config: Array<DataProviderConfigEntry>;
  /** The configuration fields the provider declares. */
  configFields: Array<DataProviderConfigField>;
  createdAt: Scalars["DateTime"]["output"];
  /** The redacted OAuth application credentials configured for the token's organization. */
  credentials: DataProviderCredentials;
  /** Who supplies the OAuth application: `shared` (WorkOS), `custom` (the developer), or `organization` (the organization itself). */
  credentialsType: Scalars["String"]["output"];
  /** The scopes the developer configured, before any organization override. */
  defaultScopes: Array<Scalars["String"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  /** Whether members may connect this provider: the organization's override when one exists, otherwise the developer default. */
  enabled: Scalars["Boolean"]["output"];
  /** The URL of the provider logo for dark backgrounds, when one is served. */
  iconDarkUrl?: Maybe<Scalars["String"]["output"]>;
  /** The slug of the provider's icon in the widget icon set. Falls back to the provider type. */
  iconSlug?: Maybe<Scalars["String"]["output"]>;
  /** The URL of the provider logo for light backgrounds, when one is served. */
  iconUrl?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  integrationType: Scalars["String"]["output"];
  name: Scalars["String"]["output"];
  /** The organization's override when set, otherwise the developer default. */
  scopes?: Maybe<Array<Scalars["String"]["output"]>>;
  slug: Scalars["String"]["output"];
  /** The configuration state of the data provider: `valid`, `invalid`, or `requested`. */
  state: Scalars["String"]["output"];
  updatedAt: Scalars["DateTime"]["output"];
};

export type ConfigurableDataProviderList = {
  __typename?: "ConfigurableDataProviderList";
  data: Array<ConfigurableDataProvider>;
  listMetadata: ListMetadata;
};

/** Input for confirming an email change with the verification code. */
export type ConfirmEmailChangeInput = {
  /** The verification code sent to the new email address. */
  code: Scalars["String"]["input"];
  /** The elevated access token from a successful `verifyCurrentEmail` call. */
  elevatedAccessToken: Scalars["String"]["input"];
};

export type ConfirmEmailChangeResult =
  | EmailChangeCodeExpired
  | EmailChangeCodeIncorrect
  | EmailChangeCodePreviouslyUsed
  | EmailChangeConfirmed
  | EmailChangeTooManyAttempts
  | EmailManagedByProvider
  | EmailNotAvailable
  | IdentityVerificationExpired
  | IdentityVerificationInvalid
  | InvalidEmail
  | NoPendingEmailChange;

export type ConnectDataProviderResult =
  | DataProviderAuthMethodUnsupported
  | DataProviderConfigInvalid
  | DataProviderConnected
  | DataProviderConnectionAuthMethodConflict;

export type ConnectDataProviderWithClientCredentialsInput = {
  /** A display name for the connection. Omit to preserve the existing label; null clears it. */
  accountDisplayName?: InputMaybe<Scalars["String"]["input"]>;
  /** The OAuth client ID issued by the data provider. Only data providers whose `authMethods` include `client_credentials` can be connected this way. */
  clientId: Scalars["String"]["input"];
  /** The OAuth client secret issued by the data provider. Write-only: it is stored encrypted and never returned. */
  clientSecret: Scalars["String"]["input"];
  /** Values for the provider’s connection configuration fields. */
  config?: InputMaybe<Array<DataProviderConfigEntryInput>>;
  /** The exact connection to reauthorize. Required with Reauthorize and forbidden otherwise. */
  connectedAccountId?: InputMaybe<Scalars["ID"]["input"]>;
  /** Set to Add to create another connection. Omit for permanent compatibility behavior. When additional connections are unavailable for the environment, Add succeeds only when the owner has no connection for this data provider and otherwise fails with the error "Multiple connections are not available." Use canAddConnection and addConnectionMethods for current availability; writes recheck the provider, actor, gate, and connection cap. */
  connectionIntent?: InputMaybe<ConnectionIntent>;
  /** The data provider to connect the authenticated user to. */
  dataProviderId: Scalars["ID"]["input"];
  /** Makes retries of an Add return the connection the first attempt created instead of creating another. Reuse the same key for every retry of one user action. A matching retry within 24 hours returns the existing connection; reusing the key for a different owner, data provider, or authentication method, or after 24 hours while that connection exists, fails with idempotency_key_conflict. Ignored unless connectionIntent is Add. */
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
};

export type ConnectOrganizationDataProviderWithClientCredentialsInput = {
  /** A display name for the connection. Omit to preserve the existing label; null clears it. */
  accountDisplayName?: InputMaybe<Scalars["String"]["input"]>;
  /** The OAuth client ID issued by the data provider. Only data providers whose `authMethods` include `client_credentials` can be connected this way. */
  clientId: Scalars["String"]["input"];
  /** The OAuth client secret issued by the data provider, shared by every member of the organization. Write-only: it is stored encrypted and never returned. */
  clientSecret: Scalars["String"]["input"];
  /** Values for the provider’s connection configuration fields. */
  config?: InputMaybe<Array<DataProviderConfigEntryInput>>;
  /** The exact connection to reauthorize. Required with Reauthorize and forbidden otherwise. */
  connectedAccountId?: InputMaybe<Scalars["ID"]["input"]>;
  /** Set to Add to create another connection. Omit for permanent compatibility behavior. When additional connections are unavailable for the environment, Add succeeds only when the owner has no connection for this data provider and otherwise fails with the error "Multiple connections are not available." Use canAddConnection and addConnectionMethods for current availability; writes recheck the provider, actor, gate, and connection cap. */
  connectionIntent?: InputMaybe<ConnectionIntent>;
  /** The organization-owned data provider to connect (`organizationDataProviders`). */
  dataProviderId: Scalars["ID"]["input"];
  /** Makes retries of an Add return the connection the first attempt created instead of creating another. Reuse the same key for every retry of one user action. A matching retry within 24 hours returns the existing connection; reusing the key for a different owner, data provider, or authentication method, or after 24 hours while that connection exists, fails with idempotency_key_conflict. Ignored unless connectionIntent is Add. */
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  /** The organization member the credentials are attributed to. With a user session token, omit it to use the session user, or pass that same user; any other user is rejected. With an application credential token, it is required and must name an active member of the token organization. */
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

/** An OAuth profile linked to the authenticated user. */
export type ConnectedAccount = {
  __typename?: "ConnectedAccount";
  email?: Maybe<Scalars["String"]["output"]>;
  firstName?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  lastLoginAt?: Maybe<Scalars["DateTime"]["output"]>;
  lastName?: Maybe<Scalars["String"]["output"]>;
  profilePictureUrl?: Maybe<Scalars["String"]["output"]>;
  provider: OAuthProvider;
};

/** An SSO connection belonging to the organization. Mirrors the SSO Connection exposed by the REST connections API. */
export type Connection = {
  __typename?: "Connection";
  createdAt: Scalars["DateTime"]["output"];
  id: Scalars["ID"]["output"];
  /** The most recent sign-in session through this connection, if any. */
  lastSession?: Maybe<SsoConnectionSession>;
  /** The most recently expired SAML certificate when the connection has no valid certificate left, if any. Always null for OpenID Connect connections. */
  latestExpiredCertificate?: Maybe<X509Certificate>;
  /** The connection's longest-lived unexpired SAML certificate when it expires within the next three months, if any. Null when a certificate valid beyond that window exists. Always null for OpenID Connect connections. */
  latestExpiringCertificate?: Maybe<X509Certificate>;
  /** A human-readable name for the connection. */
  name: Scalars["String"]["output"];
  /** The organization the connection belongs to. */
  organizationId?: Maybe<Scalars["ID"]["output"]>;
  /** Whether the connection speaks SAML or OpenID Connect. */
  providerTag: SsoProviderTag;
  /** Whether the connection has completed its IdP setup and can authenticate users (equivalent to an `Active` state). */
  setupComplete: Scalars["Boolean"]["output"];
  /** The connection's IdP setup status. `Active` indicates setup is complete; other states indicate where the connection is in its setup flow. */
  state: ConnectionState;
  /** The identity provider type of the connection. */
  type: ConnectionType;
  updatedAt: Scalars["DateTime"]["output"];
};

/** An explicit request to add another connection or reauthorize one exact connection. Omit it for permanent compatibility behavior. */
export type ConnectionIntent = "Add" | "Reauthorize";

/** Enum represents the state of the connection. */
export type ConnectionState = "Active" | "Deleting" | "Inactive" | "Validating";

/** Enum represents the type of connection. */
export type ConnectionType =
  | "ADFSSAML"
  | "AdpOidc"
  | "AppleOAuth"
  | "Auth0Migration"
  | "Auth0SAML"
  | "AzureSAML"
  | "BitbucketOAuth"
  | "CasSAML"
  | "ClassLinkSAML"
  | "CleverOIDC"
  | "CloudflareSAML"
  | "CyberArkSAML"
  | "DiscordOAuth"
  | "DuoSAML"
  | "EntraIdOIDC"
  | "GenericOIDC"
  | "GenericSAML"
  | "GitLabOAuth"
  | "GithubOAuth"
  | "GoogleOAuth"
  | "GoogleOIDC"
  | "GoogleSAML"
  | "GrokOAuth"
  | "IntuitOAuth"
  | "JumpCloudSAML"
  | "KeycloakSAML"
  | "LastPassSAML"
  | "LinkedInOAuth"
  | "LoginGovOidc"
  | "MagicLink"
  | "MicrosoftOAuth"
  | "MiniOrangeSAML"
  | "NetIqSAML"
  | "OktaOIDC"
  | "OktaSAML"
  | "OneLoginSAML"
  | "OracleSAML"
  | "PingFederateSAML"
  | "PingOneSAML"
  | "RipplingSAML"
  | "SalesforceOAuth"
  | "SalesforceSAML"
  | "ShibbolethGenericSAML"
  | "ShibbolethSAML"
  | "SimpleSamlPhpSAML"
  | "SlackOAuth"
  | "TestIdp"
  | "VMwareSAML"
  | "VercelMarketplaceOAuth"
  | "VercelOAuth"
  | "XOAuth"
  | "XeroOAuth";

/** Input for creating an API key. The organization is taken from the token, never from an argument. */
export type CreateApiKeyInput = {
  /** When the key should expire. Must be in the future. Omit for a key that never expires. */
  expiresAt?: InputMaybe<Scalars["DateTime"]["input"]>;
  /** The human-readable name of the key. */
  name: Scalars["String"]["input"];
  /** The permission slugs to grant the key. Each slug must be enabled for API keys in the environment, and must be a permission the caller itself holds. Defaults to no permissions. */
  permissions?: InputMaybe<Array<Scalars["String"]["input"]>>;
};

export type CreateAuditLogExportInput = {
  actions?: InputMaybe<Array<Scalars["String"]["input"]>>;
  actorIds?: InputMaybe<Array<Scalars["String"]["input"]>>;
  actorNames?: InputMaybe<Array<Scalars["String"]["input"]>>;
  rangeEnd: Scalars["DateTime"]["input"];
  rangeStart: Scalars["DateTime"]["input"];
  targetIds?: InputMaybe<Array<Scalars["String"]["input"]>>;
  targetTypes?: InputMaybe<Array<Scalars["String"]["input"]>>;
};

export type CreateAuditLogExportResult =
  AuditLogExport | InvalidAuditLogExportDateRange | NoAuditEventsFound;

export type CreateDataProviderAuthorizationInput = {
  /** A display name for the connection. Omit to preserve the existing label; null clears it. */
  accountDisplayName?: InputMaybe<Scalars["String"]["input"]>;
  /** Values for the provider’s connect-time configuration fields. Omit when the provider declares none. */
  config?: InputMaybe<Array<DataProviderConfigEntryInput>>;
  /** The exact connection to reauthorize. Required with Reauthorize and forbidden otherwise. */
  connectedAccountId?: InputMaybe<Scalars["ID"]["input"]>;
  /** Add another connection or reauthorize one exact connection. Omit for permanent compatibility behavior. When additional connections are unavailable for the environment, Add succeeds only when the owner has no connection for this data provider and otherwise returns DataProviderAuthorizationUnavailable. Use canAddConnection and addConnectionMethods for current availability; writes recheck the provider, actor, gate, and connection cap. */
  connectionIntent?: InputMaybe<ConnectionIntent>;
  /** The data provider to authorize for the authenticated user. It must be one the user can connect (`dataProviders`). */
  dataProviderId: Scalars["ID"]["input"];
  /** Request a confirmation step at the end of the flow, returning a `handoffToken` the client must complete. Defaults to false. */
  requireHandoff?: InputMaybe<Scalars["Boolean"]["input"]>;
};

export type CreateDataProviderAuthorizationResult =
  | DataProviderAuthorization
  | DataProviderAuthorizationUnavailable
  | DataProviderConfigInvalid;

export type CreateDataProviderConnectionInput = {
  /** A display name for the connection. Omit to preserve the existing label; null clears it. */
  accountDisplayName?: InputMaybe<Scalars["String"]["input"]>;
  /** The API key issued by the data provider. Only data providers whose `authMethods` include `api_key` can be connected this way; OAuth providers are connected through the widget's authorization flow. */
  apiKey: Scalars["String"]["input"];
  /** The exact connection to reauthorize. Required with Reauthorize and forbidden otherwise. */
  connectedAccountId?: InputMaybe<Scalars["ID"]["input"]>;
  /** Set to Add to create another connection. Omit for permanent compatibility behavior. When additional connections are unavailable for the environment, Add succeeds only when the owner has no connection for this data provider and otherwise fails with the error "Multiple connections are not available." Use canAddConnection and addConnectionMethods for current availability; writes recheck the provider, actor, gate, and connection cap. */
  connectionIntent?: InputMaybe<ConnectionIntent>;
  /** The data provider to connect the authenticated user to. */
  dataProviderId: Scalars["ID"]["input"];
  /** Makes retries of an Add return the connection the first attempt created instead of creating another. Reuse the same key for every retry of one user action. A matching retry within 24 hours returns the existing connection; reusing the key for a different owner, data provider, or authentication method, or after 24 hours while that connection exists, fails with idempotency_key_conflict. Ignored unless connectionIntent is Add. */
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
};

export type CreateOrganizationApiKeyResult =
  | ApiKeyPermissionsNotHeld
  | ApiKeyPermissionsUnsupportedForToken
  | InvalidApiKeyExpiration
  | InvalidApiKeyName
  | InvalidApiKeyPermissions
  | OrganizationApiKeyCreated;

export type CreateOrganizationDataProviderAuthorizationInput = {
  /** A display name for the connection. Omit to preserve the existing label; null clears it. */
  accountDisplayName?: InputMaybe<Scalars["String"]["input"]>;
  /** Values for the provider’s connect-time configuration fields. Omit when the provider declares none. */
  config?: InputMaybe<Array<DataProviderConfigEntryInput>>;
  /** The exact connection to reauthorize. Required with Reauthorize and forbidden otherwise. */
  connectedAccountId?: InputMaybe<Scalars["ID"]["input"]>;
  /** Add another connection or reauthorize one exact connection. Omit for permanent compatibility behavior. When additional connections are unavailable for the environment, Add succeeds only when the owner has no connection for this data provider and otherwise returns DataProviderAuthorizationUnavailable. Use canAddConnection and addConnectionMethods for current availability; writes recheck the provider, actor, gate, and connection cap. */
  connectionIntent?: InputMaybe<ConnectionIntent>;
  /** The organization-owned data provider to authorize (`organizationDataProviders`). */
  dataProviderId: Scalars["ID"]["input"];
};

export type CreateOrganizationDataProviderConnectionInput = {
  /** A display name for the connection. Omit to preserve the existing label; null clears it. */
  accountDisplayName?: InputMaybe<Scalars["String"]["input"]>;
  /** The API key issued by the data provider, shared by every member of the organization. Only data providers whose `authMethods` include `api_key` can be connected this way. Write-only: it is stored encrypted and never returned. */
  apiKey: Scalars["String"]["input"];
  /** The exact connection to reauthorize. Required with Reauthorize and forbidden otherwise. */
  connectedAccountId?: InputMaybe<Scalars["ID"]["input"]>;
  /** Set to Add to create another connection. Omit for permanent compatibility behavior. When additional connections are unavailable for the environment, Add succeeds only when the owner has no connection for this data provider and otherwise fails with the error "Multiple connections are not available." Use canAddConnection and addConnectionMethods for current availability; writes recheck the provider, actor, gate, and connection cap. */
  connectionIntent?: InputMaybe<ConnectionIntent>;
  /** The organization-owned data provider to connect (`organizationDataProviders`). */
  dataProviderId: Scalars["ID"]["input"];
  /** Makes retries of an Add return the connection the first attempt created instead of creating another. Reuse the same key for every retry of one user action. A matching retry within 24 hours returns the existing connection; reusing the key for a different owner, data provider, or authentication method, or after 24 hours while that connection exists, fails with idempotency_key_conflict. Ignored unless connectionIntent is Add. */
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  /** The organization member the credentials are attributed to. With a user session token, omit it to use the session user, or pass that same user; any other user is rejected. With an application credential token, it is required and must name an active member of the token organization. */
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

/** Input for setting a password on an account that does not yet have one (e.g. signed up via OAuth). */
export type CreatePasswordInput = {
  /** An elevated access token obtained by verifying the current email address. Required to prove recent re-authentication. */
  elevatedAccessToken: Scalars["String"]["input"];
  /** The password to set. Must satisfy the environment password policy. */
  password: Scalars["String"]["input"];
};

export type CreatePasswordResult =
  | ElevatedAccessTokenExpired
  | ElevatedAccessTokenInvalid
  | PasswordCreated
  | PasswordPolicyViolation
  | UserAlreadyHasPassword;

export type CreateRoleInput = {
  /** Optional human-readable description of the role. */
  description?: InputMaybe<Scalars["String"]["input"]>;
  /** Human-readable name for the role. */
  name: Scalars["String"]["input"];
  /** Slugs of the permissions granted to the role. */
  permissions?: InputMaybe<Array<Scalars["String"]["input"]>>;
  /** Unique slug identifying the role. Generated from the name when omitted. */
  slug?: InputMaybe<Scalars["String"]["input"]>;
};

export type CreateSsoConnectionInput = {
  /** A human-readable name for the connection. Defaults to the organization's name. */
  name?: InputMaybe<Scalars["String"]["input"]>;
  /** The identity provider type of the connection to create. */
  type: ConnectionType;
};

export type CreateUserApiKeyResult =
  | ApiKeyPermissionsNotHeld
  | ApiKeyPermissionsUnsupportedForToken
  | InvalidApiKeyExpiration
  | InvalidApiKeyName
  | InvalidApiKeyPermissions
  | UserApiKeyCreated;

/** The current email was verified successfully. */
export type CurrentEmailVerified = {
  __typename?: "CurrentEmailVerified";
  /** The elevated access token to pass to `sendEmailChange` and `confirmEmailChange`. */
  elevatedAccessToken: Scalars["String"]["output"];
  /** When the elevated access token expires (ISO 8601). */
  expiresAt: Scalars["String"]["output"];
};

/** Daily verification email quota exceeded. */
export type DailyEmailQuotaExceeded = {
  __typename?: "DailyEmailQuotaExceeded";
  message: Scalars["String"]["output"];
};

/** Whether a data installation is the compatibility connection or a standard connection. */
export type DataInstallationConnectionRole = "Compatibility" | "Standard";

/** A third-party data provider configured for the current environment. */
export type DataProvider = {
  __typename?: "DataProvider";
  /** How accounts authenticate with this data provider. */
  authMethods: Array<Scalars["String"]["output"]>;
  capabilities: DataProviderCapabilities;
  /** The non-secret configuration values pinned for the token's organization (or by the developer, for a provider whose credentials the developer manages). */
  config: Array<DataProviderConfigEntry>;
  /** The configuration fields the provider declares. */
  configFields: Array<DataProviderConfigField>;
  createdAt: Scalars["DateTime"]["output"];
  /** Who supplies the OAuth application: `shared` (WorkOS), `custom` (the developer), or `organization` (the organization itself). */
  credentialsType: Scalars["String"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  /** Whether the data provider is enabled for the token's organization: it must be enabled in the environment and not disabled by the organization's override. */
  enabled: Scalars["Boolean"]["output"];
  /** The URL of the provider logo for dark backgrounds, when one is served. */
  iconDarkUrl?: Maybe<Scalars["String"]["output"]>;
  /** The slug of the provider's icon in the widget icon set. Falls back to the provider type. */
  iconSlug?: Maybe<Scalars["String"]["output"]>;
  /** The URL of the provider logo for light backgrounds, when one is served. */
  iconUrl?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  /** The provider type this data provider was created from. */
  integrationType: Scalars["String"]["output"];
  /** The display name of the data provider. */
  name: Scalars["String"]["output"];
  /** The OAuth scopes configured for the data provider. `null` when the provider's default scopes are used. */
  scopes?: Maybe<Array<Scalars["String"]["output"]>>;
  /** The slug of the data provider. */
  slug: Scalars["String"]["output"];
  /** The configuration state of the data provider: `valid`, `invalid`, or `requested`. */
  state: Scalars["String"]["output"];
  updatedAt: Scalars["DateTime"]["output"];
};

/** The data provider cannot be connected the requested way — for example client credentials for a provider that only supports OAuth. */
export type DataProviderAuthMethodUnsupported = {
  __typename?: "DataProviderAuthMethodUnsupported";
  /** The unsupported auth method that was requested. */
  authMethod: Scalars["String"]["output"];
  /** The auth methods the data provider does support. */
  supportedAuthMethods: Array<Scalars["String"]["output"]>;
};

/** A started authorization: the URL to open and the state to poll while the user completes it. */
export type DataProviderAuthorization = {
  __typename?: "DataProviderAuthorization";
  /** Present when the flow ends on a confirmation step the client must complete instead of finishing silently. Always present for organization-scoped authorization. */
  handoffToken?: Maybe<Scalars["String"]["output"]>;
  /** One-time token the interstitial URL is keyed by. Retained so a client can correlate the popup it opened. */
  redirectToken: Scalars["String"]["output"];
  /** The OAuth `state` for this attempt. Poll `dataProviderAuthorizationStatus` with it to observe completion. */
  state: Scalars["String"]["output"];
  /** The WorkOS interstitial URL to open in the popup. It redirects to the provider once, then expires. */
  url: Scalars["String"]["output"];
};

/** Whether an authorization attempt is still in progress. */
export type DataProviderAuthorizationStatus = {
  __typename?: "DataProviderAuthorizationStatus";
  /** True while the attempt is outstanding. It becomes false once the provider callback has been handled or the attempt expired, so a client that sees false reloads the connection to learn the outcome. */
  connecting: Scalars["Boolean"]["output"];
  /** The `state` that was polled. */
  state: Scalars["String"]["output"];
};

/** The data provider cannot start an authorization right now — most often because the organization has not supplied its own OAuth credentials yet. */
export type DataProviderAuthorizationUnavailable = {
  __typename?: "DataProviderAuthorizationUnavailable";
  message: Scalars["String"]["output"];
};

/** Advisory explicit-add availability for the token-scoped owner. Writes still check authorization and creation policy. */
export type DataProviderCapabilities = {
  __typename?: "DataProviderCapabilities";
  /** The auth methods currently available to this token for explicit Add: oauth, api_key, or client_credentials. Interactive OAuth requires a member session. Empty exactly when canAddConnection is false. */
  addConnectionMethods: Array<Scalars["String"]["output"]>;
  /** Whether an explicit Add is available for this provider and owner. Counts all connections, not a page of results. The server rechecks before creating. */
  canAddConnection: Scalars["Boolean"]["output"];
};

/** A non-secret configuration value set on a data provider. */
export type DataProviderConfigEntry = {
  __typename?: "DataProviderConfigEntry";
  /** The configuration field declared by the provider. */
  name: Scalars["String"]["output"];
  /** The value set for the field. */
  value: Scalars["String"]["output"];
};

export type DataProviderConfigEntryInput = {
  /** The configuration field declared by the provider. */
  name: Scalars["String"]["input"];
  /** The value to set for the field. */
  value: Scalars["String"]["input"];
};

/** A configuration field a data provider declares, describing a value collected when the provider is configured or connected. */
export type DataProviderConfigField = {
  __typename?: "DataProviderConfigField";
  /** The value used when the field is left unset. */
  default?: Maybe<Scalars["String"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  /** An example value, for display only. */
  example?: Maybe<Scalars["String"]["output"]>;
  /** The name of the field. Matches `name` on the corresponding config entry. */
  key: Scalars["String"]["output"];
  /** The label to show for the field. */
  label: Scalars["String"]["output"];
  /** The position of the field relative to its siblings. */
  order?: Maybe<Scalars["Int"]["output"]>;
  /** A regular expression the value must match. */
  pattern?: Maybe<Scalars["String"]["output"]>;
  /** The flags to apply `pattern` with (`i` and/or `u`). */
  patternFlags?: Maybe<Scalars["String"]["output"]>;
  required: Scalars["Boolean"]["output"];
  /** Whether the value is set once for the data provider (`integration`) or collected from each account that connects (`installation`). */
  scope: Scalars["String"]["output"];
  /** Whether the value is sensitive, so it is masked on input. Secret `installation`-scope values are never read back on a connection. */
  secret?: Maybe<Scalars["Boolean"]["output"]>;
};

/** The supplied configuration does not satisfy the provider’s declared fields. */
export type DataProviderConfigInvalid = {
  __typename?: "DataProviderConfigInvalid";
  /** Which field is missing, unknown, or malformed. Names the field so a client can highlight it. */
  message: Scalars["String"]["output"];
};

/** A data provider's configuration for the token's organization, excluding secret values. */
export type DataProviderConfiguration = {
  __typename?: "DataProviderConfiguration";
  /** Every scope the organization may request. Only populated for providers where the organization brings its own OAuth credentials; empty otherwise. */
  availableScopes: Array<Scalars["String"]["output"]>;
  config: Array<DataProviderConfigEntry>;
  /** The data provider being configured. */
  dataProviderId: Scalars["ID"]["output"];
  dataProviderSlug: Scalars["String"]["output"];
  /** Whether the organization's users can see and connect the data provider. */
  enabled: Scalars["Boolean"]["output"];
  /** Whether the organization has supplied its own OAuth client credentials. Always false for a provider whose credentials the developer manages. The values themselves are never returned. */
  hasCredentials: Scalars["Boolean"]["output"];
  /** The organization the configuration applies to. */
  organizationId: Scalars["ID"]["output"];
  /** The scopes the organization requests, or null to use the provider defaults. */
  scopes?: Maybe<Array<Scalars["String"]["output"]>>;
  updatedAt: Scalars["DateTime"]["output"];
};

/** The connection was created or its credentials were replaced. */
export type DataProviderConnected = {
  __typename?: "DataProviderConnected";
  connection: DataProviderConnection;
};

/** A connection between a data provider and a user or organization. */
export type DataProviderConnection = {
  __typename?: "DataProviderConnection";
  /** A mutable, non-unique display name for this connection. */
  accountDisplayName?: Maybe<Scalars["String"]["output"]>;
  /** A best-effort provider account identifier used for correlation, not connection selection. */
  accountIdentifier?: Maybe<Scalars["String"]["output"]>;
  /** The last four characters of the API key of an `api_key` connection, to recognize it by. The key itself is never returned. */
  apiKeyLast4?: Maybe<Scalars["String"]["output"]>;
  /** How the connection authenticates: `oauth`, `api_key`, or `client_credentials`. */
  authMethod: Scalars["String"]["output"];
  /** Whether the connection can be used right now: `available`, or `needs_admin_attention` when it must be re-authorized first. */
  availability: Scalars["String"]["output"];
  /** Actions available on this exact organization-owned connection. Null for user-owned connections; member row-action behavior is unchanged. */
  capabilities?: Maybe<DataProviderConnectionCapabilities>;
  /** The OAuth client ID of a `client_credentials` connection. Null for other auth methods. */
  clientId?: Maybe<Scalars["String"]["output"]>;
  /** The last four characters of the OAuth client secret of a `client_credentials` connection, to recognize it by. The secret itself is never returned. */
  clientSecretLast4?: Maybe<Scalars["String"]["output"]>;
  /** The stored, provider-declared connection-scope configuration values for any authentication method, excluding secret fields. Empty when no stored values can be disclosed. */
  config: Array<DataProviderConfigEntry>;
  /** Whether this is the compatibility connection or a standard connection. */
  connectionRole: DataInstallationConnectionRole;
  createdAt: Scalars["DateTime"]["output"];
  /** The data provider this connection was created for. */
  dataProviderId: Scalars["ID"]["output"];
  /** The slug of the connected data provider. */
  dataProviderSlug: Scalars["String"]["output"];
  /** The user whose authorization established the connection. Null when the connection is developer-managed or its establisher is unknown, and after the establishing member left the organization (see `stateReason`). */
  establishedByUserId?: Maybe<Scalars["ID"]["output"]>;
  id: Scalars["ID"]["output"];
  organizationId?: Maybe<Scalars["ID"]["output"]>;
  /** The OAuth scopes granted for this connection. */
  scopes: Array<Scalars["String"]["output"]>;
  /** The status of the connection: `connected` or `needs_reauthorization`. */
  state: Scalars["String"]["output"];
  /** Why WorkOS put the connection in its current `state`, e.g. `establishing_member_membership_ended` when the member who established an organization-owned connection left the organization. Null when there is no WorkOS-recorded reason. Additional values may be added. */
  stateReason?: Maybe<Scalars["String"]["output"]>;
  updatedAt: Scalars["DateTime"]["output"];
  userId?: Maybe<Scalars["ID"]["output"]>;
  /** Non-blocking warnings about the saved label from a credential write that supplied accountDisplayName. Empty when no duplicate exists; null on reads or when the label was omitted. */
  warnings?: Maybe<Array<DataProviderConnectionLabelWarning>>;
};

/** The connection owner already has a connection to this data provider that authenticates differently, so it must be disconnected first. */
export type DataProviderConnectionAuthMethodConflict = {
  __typename?: "DataProviderConnectionAuthMethodConflict";
  /** How the existing connection authenticates. */
  existingAuthMethod: Scalars["String"]["output"];
};

/** Advisory repair actions for this exact organization-owned connection, independent of sibling connections and the additional-creation cap or gate. */
export type DataProviderConnectionCapabilities = {
  __typename?: "DataProviderConnectionCapabilities";
  /** Whether this OAuth connection needs reauthorization, its provider is enabled and configured for OAuth, and the token represents a member session. */
  canReauthorize: Scalars["Boolean"]["output"];
  /** Whether the enabled provider supports replacing this connection's API key or client credentials. */
  canUpdateCredentials: Scalars["Boolean"]["output"];
};

export type DataProviderConnectionLabelWarning = {
  __typename?: "DataProviderConnectionLabelWarning";
  /** The advisory warning code: duplicate_account_display_name. */
  code: Scalars["String"]["output"];
  /** An explanation of the warning. A duplicate label never blocks the update. */
  message: Scalars["String"]["output"];
};

export type DataProviderConnectionList = {
  __typename?: "DataProviderConnectionList";
  data: Array<DataProviderConnection>;
  listMetadata: ListMetadata;
};

/** The OAuth application credentials configured for a data provider in the token's organization, redacted to what an admin needs to recognize them. */
export type DataProviderCredentials = {
  __typename?: "DataProviderCredentials";
  /** The OAuth client ID the organization supplied. Null unless the organization brings its own credentials. */
  clientId?: Maybe<Scalars["String"]["output"]>;
  /** Who supplies the OAuth application: `shared` (WorkOS), `custom` (the developer), or `organization` (the organization itself). */
  credentialsType: Scalars["String"]["output"];
  /** Whether the organization has supplied its own OAuth client credentials. Always false for a provider whose credentials the developer manages. */
  hasCredentials: Scalars["Boolean"]["output"];
  /** The last four characters of the OAuth client secret the organization supplied, to recognize it by. The secret itself is never returned. */
  redactedClientSecret?: Maybe<Scalars["String"]["output"]>;
  /** The redirect URI to register with the provider when creating an OAuth application. */
  redirectUri: Scalars["String"]["output"];
};

export type DataProviderList = {
  __typename?: "DataProviderList";
  data: Array<DataProvider>;
  listMetadata: ListMetadata;
};

/** Input for deleting a passkey. */
export type DeletePasskeyInput = {
  /** An elevated access token obtained by verifying the current email address. Required to prove recent re-authentication. */
  elevatedAccessToken: Scalars["String"]["input"];
  /** The ID of the passkey to delete. */
  passkeyId: Scalars["ID"]["input"];
};

export type DeletePasskeyResult =
  | ElevatedAccessTokenExpired
  | ElevatedAccessTokenInvalid
  | PasskeyDeleted
  | PasskeyNotFound;

export type DeleteRoleInput = {
  /** The ID of the role to delete. */
  id: Scalars["ID"]["input"];
};

/** A Directory Sync connection within the current environment. */
export type Directory = {
  __typename?: "Directory";
  createdAt: Scalars["DateTime"]["output"];
  externalKey: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  /** When the most recent sync run for the directory was last updated, or null if no sync run has started. */
  lastSyncRunAt?: Maybe<Scalars["DateTime"]["output"]>;
  /** Counts of the users and groups provisioned through the directory. */
  metadata: DirectoryMetadata;
  name: Scalars["String"]["output"];
  organizationId: Scalars["ID"]["output"];
  /** The linking state of the directory. */
  state: Scalars["String"]["output"];
  /** The provider type of the directory. */
  type: Scalars["String"]["output"];
  updatedAt: Scalars["DateTime"]["output"];
};

/** A group provisioned through a Directory Sync connection. */
export type DirectoryGroup = {
  __typename?: "DirectoryGroup";
  createdAt: Scalars["DateTime"]["output"];
  directoryId: Scalars["ID"]["output"];
  id: Scalars["ID"]["output"];
  /** The identifier of the group in the identity provider. */
  idpId: Scalars["String"]["output"];
  name: Scalars["String"]["output"];
  organizationId: Scalars["ID"]["output"];
  updatedAt: Scalars["DateTime"]["output"];
};

export type DirectoryGroupList = {
  __typename?: "DirectoryGroupList";
  data: Array<DirectoryGroup>;
  listMetadata: ListMetadata;
};

export type DirectoryList = {
  __typename?: "DirectoryList";
  data: Array<Directory>;
  listMetadata: ListMetadata;
};

/** Counts of the users and groups provisioned through a directory. */
export type DirectoryMetadata = {
  __typename?: "DirectoryMetadata";
  groups: Scalars["Int"]["output"];
  users: DirectoryUsersMetadata;
};

/** A user provisioned through a Directory Sync connection. */
export type DirectoryUser = {
  __typename?: "DirectoryUser";
  createdAt: Scalars["DateTime"]["output"];
  directoryId: Scalars["ID"]["output"];
  email?: Maybe<Scalars["String"]["output"]>;
  firstName?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  /** The identifier of the user in the identity provider. */
  idpId: Scalars["String"]["output"];
  lastName?: Maybe<Scalars["String"]["output"]>;
  organizationId: Scalars["ID"]["output"];
  /** The provisioning state of the directory user. */
  state: Scalars["String"]["output"];
  updatedAt: Scalars["DateTime"]["output"];
  username?: Maybe<Scalars["String"]["output"]>;
};

export type DirectoryUserList = {
  __typename?: "DirectoryUserList";
  data: Array<DirectoryUser>;
  listMetadata: ListMetadata;
};

/** Counts of the users provisioned through a directory, by state. */
export type DirectoryUsersMetadata = {
  __typename?: "DirectoryUsersMetadata";
  active: Scalars["Int"]["output"];
  inactive: Scalars["Int"]["output"];
};

/** The DNS name server provider detected for a domain. */
export type DomainVerificationNameServer =
  "AwsRoute53" | "CloudFlare" | "GoDaddy" | "GoogleDomains" | "Other";

/** The elevated access token has expired. The user must re-verify their identity. */
export type ElevatedAccessTokenExpired = {
  __typename?: "ElevatedAccessTokenExpired";
  message: Scalars["String"]["output"];
};

/** The elevated access token is invalid. */
export type ElevatedAccessTokenInvalid = {
  __typename?: "ElevatedAccessTokenInvalid";
  message: Scalars["String"]["output"];
};

/** The verification code has expired. */
export type EmailChangeCodeExpired = {
  __typename?: "EmailChangeCodeExpired";
  message: Scalars["String"]["output"];
};

/** The verification code is incorrect. */
export type EmailChangeCodeIncorrect = {
  __typename?: "EmailChangeCodeIncorrect";
  message: Scalars["String"]["output"];
};

/** The verification code has already been used. */
export type EmailChangeCodePreviouslyUsed = {
  __typename?: "EmailChangeCodePreviouslyUsed";
  message: Scalars["String"]["output"];
};

/** The email was changed successfully. */
export type EmailChangeConfirmed = {
  __typename?: "EmailChangeConfirmed";
  /** A fresh elevated access token for subsequent elevated operations. */
  elevatedAccessToken: Scalars["String"]["output"];
  /** When the elevated access token expires (ISO 8601). */
  expiresAt: Scalars["String"]["output"];
  user: User;
};

/** Email change is not available for this account. */
export type EmailChangeNotAvailable = {
  __typename?: "EmailChangeNotAvailable";
  message: Scalars["String"]["output"];
};

/** A verification code was sent to the new email address. */
export type EmailChangeSent = {
  __typename?: "EmailChangeSent";
  /** When the verification code expires. */
  expiresAt: Scalars["DateTime"]["output"];
};

/** Too many verification attempts. */
export type EmailChangeTooManyAttempts = {
  __typename?: "EmailChangeTooManyAttempts";
  message: Scalars["String"]["output"];
};

/** The email is managed by an identity provider and cannot be changed. */
export type EmailManagedByProvider = {
  __typename?: "EmailManagedByProvider";
  message: Scalars["String"]["output"];
};

/** The email address is not available. */
export type EmailNotAvailable = {
  __typename?: "EmailNotAvailable";
  message: Scalars["String"]["output"];
};

/** Input for enrolling a new TOTP factor. */
export type EnrollTotpInput = {
  /** An elevated access token obtained by verifying the current email address. Required to prove recent re-authentication. */
  elevatedAccessToken: Scalars["String"]["input"];
};

export type EnrollTotpResult =
  | ElevatedAccessTokenExpired
  | ElevatedAccessTokenInvalid
  | TotpAlreadyEnrolled
  | TotpFactor;

/** Input for expiring an API key. Expiring revokes the key while retaining it and its audit trail; use the delete mutations to remove it. */
export type ExpireApiKeyInput = {
  /** The ID of the key to expire. */
  apiKeyId: Scalars["ID"]["input"];
  /** When the key should expire. A future date schedules expiration; `null` clears any scheduled expiration; omitting the field, or passing a date in the past, revokes the key immediately. */
  expiresAt?: InputMaybe<Scalars["DateTime"]["input"]>;
};

export type ExpireOrganizationApiKeyResult =
  ApiKeyAlreadyExpired | OrganizationApiKeyExpired;

export type ExpireUserApiKeyResult = ApiKeyAlreadyExpired | UserApiKeyExpired;

/** A feature flag defined in the project that owns the environment the token was issued for. Mirrors the Feature Flag exposed by the REST feature flags API. */
export type Flag = {
  __typename?: "Flag";
  createdAt: Scalars["DateTime"]["output"];
  /** The value returned for users and organizations that do not match any targeting rule in the environment the token was issued for. */
  defaultValue: Scalars["Boolean"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  /** Whether the feature flag is active in the environment the token was issued for. */
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  /** A descriptive name for the feature flag. */
  name: Scalars["String"]["output"];
  /** A unique key used to reference the feature flag. */
  slug: Scalars["String"]["output"];
  /** Labels assigned to the feature flag. */
  tags: Array<Scalars["String"]["output"]>;
  updatedAt: Scalars["DateTime"]["output"];
};

export type FlagList = {
  __typename?: "FlagList";
  data: Array<Flag>;
  listMetadata: ListMetadata;
};

/** The identity verification has expired. Please verify your current email again. */
export type IdentityVerificationExpired = {
  __typename?: "IdentityVerificationExpired";
  message: Scalars["String"]["output"];
};

/** The identity verification is no longer valid. */
export type IdentityVerificationInvalid = {
  __typename?: "IdentityVerificationInvalid";
  message: Scalars["String"]["output"];
};

/** The provided current password does not match the existing password. */
export type IncorrectPassword = {
  __typename?: "IncorrectPassword";
  _placeholder: Scalars["Boolean"]["output"];
};

/** The requested expiration is not valid. */
export type InvalidApiKeyExpiration = {
  __typename?: "InvalidApiKeyExpiration";
  message: Scalars["String"]["output"];
};

/** The provided name is not a valid API key name. */
export type InvalidApiKeyName = {
  __typename?: "InvalidApiKeyName";
  message: Scalars["String"]["output"];
};

/** One or more requested permission slugs are not enabled for API keys of this kind in the environment. */
export type InvalidApiKeyPermissions = {
  __typename?: "InvalidApiKeyPermissions";
  /** The permission slugs that were rejected. */
  invalidPermissions: Array<Scalars["String"]["output"]>;
  message: Scalars["String"]["output"];
};

export type InvalidAuditLogExportDateRange = {
  __typename?: "InvalidAuditLogExportDateRange";
  message: Scalars["String"]["output"];
};

/** The provided email address is invalid. */
export type InvalidEmail = {
  __typename?: "InvalidEmail";
  message: Scalars["String"]["output"];
};

/** The requested invitation expiry is outside the allowed range (1–30 days). */
export type InvalidInvitationExpiry = {
  __typename?: "InvalidInvitationExpiry";
  /** Placeholder field to allow an empty @ObjectType. */
  _placeholder?: Maybe<Scalars["Boolean"]["output"]>;
};

/** The provided email address is not valid. */
export type InvalidInviteeEmail = {
  __typename?: "InvalidInviteeEmail";
  email: Scalars["String"]["output"];
};

/** The requested role is not valid for this organization. */
export type InvalidInviteeRole = {
  __typename?: "InvalidInviteeRole";
  roleSlug?: Maybe<Scalars["String"]["output"]>;
};

/** The provided locale is not a valid BCP 47 tag. */
export type InvalidLocale = {
  __typename?: "InvalidLocale";
  _placeholder: Scalars["Boolean"]["output"];
};

/** No pending invitation exists for this user in this organization. */
export type InvitationNotFound = {
  __typename?: "InvitationNotFound";
  userId: Scalars["ID"]["output"];
};

/** The invitation is not pending (already accepted, expired, or revoked) and cannot be revoked. */
export type InvitationNotPending = {
  __typename?: "InvitationNotPending";
  userId: Scalars["ID"]["output"];
};

/** The invitation was resent successfully. */
export type InvitationResent = {
  __typename?: "InvitationResent";
  invitation: OrganizationInvitation;
};

/** The invitation was revoked. */
export type InvitationRevoked = {
  __typename?: "InvitationRevoked";
  invitation: OrganizationInvitation;
};

export type InviteUserInput = {
  /** The email address to invite. */
  email: Scalars["String"]["input"];
  /** Number of days until the invitation expires. Defaults to the environment setting when omitted. */
  expiresInDays?: InputMaybe<Scalars["Int"]["input"]>;
  /** Slug of the role to grant on acceptance. Defaults to the organization default role when omitted. */
  roleSlug?: InputMaybe<Scalars["String"]["input"]>;
};

export type InviteUserResult =
  | InvalidInvitationExpiry
  | InvalidInviteeEmail
  | InvalidInviteeRole
  | InviteeAlreadyInvited
  | InviteeAlreadyMember
  | InviteeEmailNotDeliverable
  | OrganizationBlockedFromSendingInvites
  | UserInvited;

/** The user has already accepted their invitation and is an active member. */
export type InviteeAlreadyAccepted = {
  __typename?: "InviteeAlreadyAccepted";
  userId: Scalars["ID"]["output"];
};

/** This email already has a pending invitation. */
export type InviteeAlreadyInvited = {
  __typename?: "InviteeAlreadyInvited";
  email: Scalars["String"]["output"];
};

/** A user with this email is already a member of the organization. */
export type InviteeAlreadyMember = {
  __typename?: "InviteeAlreadyMember";
  email: Scalars["String"]["output"];
};

/** The invitee's email domain has no mail servers, so the invitation email cannot be delivered. */
export type InviteeEmailNotDeliverable = {
  __typename?: "InviteeEmailNotDeliverable";
  email: Scalars["String"]["output"];
};

export type ListMetadata = {
  __typename?: "ListMetadata";
  after?: Maybe<Scalars["String"]["output"]>;
  before?: Maybe<Scalars["String"]["output"]>;
};

/** The member is provisioned by a directory and cannot be removed. */
export type MemberIsManagedByDirectory = {
  __typename?: "MemberIsManagedByDirectory";
  /** The user ID of the directory-managed member. */
  userId: Scalars["ID"]["output"];
};

/** No active member was found for the given user in the organization. */
export type MemberNotFound = {
  __typename?: "MemberNotFound";
  /** The user ID that did not resolve to a member. */
  userId: Scalars["ID"]["output"];
};

/** The member was removed from the organization. */
export type MemberRemoved = {
  __typename?: "MemberRemoved";
  /** The user ID of the removed member. */
  userId: Scalars["ID"]["output"];
};

/** The member's role was updated. */
export type MemberRoleUpdated = {
  __typename?: "MemberRoleUpdated";
  member: OrganizationMember;
};

/** All TOTP factors were removed successfully. */
export type MfaFactorRemoved = {
  __typename?: "MfaFactorRemoved";
  success: Scalars["Boolean"]["output"];
};

export type Mutation = {
  __typename?: "Mutation";
  /** Grant a permission to a role belonging to the organization the token was issued for. */
  assignPermissionToRole: Role;
  /** Confirms an email change using the verification code sent to the new email address. Requires an elevated access token from `verifyCurrentEmail`. */
  confirmEmailChange: ConfirmEmailChangeResult;
  /** Connect the authenticated user to a data provider with OAuth client credentials the user supplies. Replaces the credentials when the user already has a client-credentials connection to the data provider, so this is both the connect and the reconnect path. The credentials are stored encrypted and never returned. */
  connectDataProviderWithClientCredentials: ConnectDataProviderResult;
  /** Connect the token's organization to an organization-owned data provider with OAuth client credentials, producing one connection shared by every member. Replaces the credentials when the organization already has a client-credentials connection to the data provider, so this is both the connect and the reconnect path. The credentials are stored encrypted and never returned. */
  connectOrganizationDataProviderWithClientCredentials: ConnectDataProviderResult;
  /** Mint a short-lived link that starts an Admin Portal session for the token's organization, scoped to a single setup flow. */
  createAdminPortalLink: AdminPortalLink;
  createAuditLogExport: CreateAuditLogExportResult;
  /** Start an OAuth authorization connecting the authenticated user to a data provider. Returns the URL to open in a popup and the `state` to poll with `dataProviderAuthorizationStatus`. Re-authorizing a provider the user is already connected to replaces that connection's credentials once the flow completes, so this is also the reconnect path. */
  createDataProviderAuthorization: CreateDataProviderAuthorizationResult;
  /** Connect the authenticated user to a data provider with an API key the user supplies. Replaces the API key when the user already has an API-key connection to the data provider. */
  createDataProviderConnection: DataProviderConnection;
  /** Create an API key owned by the token's organization. The plaintext secret is returned exactly once, in this response. */
  createOrganizationApiKey: CreateOrganizationApiKeyResult;
  /** Start an OAuth authorization connecting the token's organization to an organization-owned data provider, producing one connection shared by every member. A handoff is always required: the member completing the flow must confirm it explicitly because the resulting connection is not their own. */
  createOrganizationDataProviderAuthorization: CreateDataProviderAuthorizationResult;
  /** Connect the token's organization to an organization-owned data provider with an API key, producing one connection shared by every member. Replaces the API key when the organization already has an API-key connection to the data provider. */
  createOrganizationDataProviderConnection: DataProviderConnection;
  /** Add a domain to the token's organization and begin DNS verification. */
  createOrganizationDomain: OrganizationDomain;
  /** Set a password for the authenticated user who does not yet have one (e.g. signed up via OAuth). Validates against the environment password policy. */
  createPassword: CreatePasswordResult;
  /** Create a role for the organization the token was issued for. */
  createRole: Role;
  /** Create an SSO connection for the token’s organization. */
  createSsoConnection: Connection;
  /** Create an API key owned by the token user within the organization the token was issued for. The plaintext secret is returned exactly once, in this response. */
  createUserApiKey: CreateUserApiKeyResult;
  /** Disconnect one of the authenticated user's data provider connections, revoking the stored credentials. */
  deleteDataProviderConnection: Scalars["ID"]["output"];
  /** Delete an API key owned by the token's organization and return the deleted key. Unlike expiring, this removes the key entirely. */
  deleteOrganizationApiKey: OrganizationApiKey;
  /** Disconnect one of the token organization's shared data provider connections, revoking the stored credentials for every member. */
  deleteOrganizationDataProviderConnection: Scalars["ID"]["output"];
  /** Delete a domain belonging to the token's organization and return it. */
  deleteOrganizationDomain: OrganizationDomain;
  /** Remove the specified passkey from the authenticated user's account. */
  deletePasskey: DeletePasskeyResult;
  /** Delete a role belonging to the organization the token was issued for. */
  deleteRole: RoleDeleted;
  /** Delete an SSO connection belonging to the token’s organization. */
  deleteSsoConnection: Scalars["ID"]["output"];
  /** Delete a user-scoped API key and return the deleted key. Unlike expiring, this removes the key entirely. */
  deleteUserApiKey: UserApiKey;
  /** Create a TOTP factor and return the secret and QR URI for the user to scan. This is step 1 of TOTP enrollment. */
  enrollTotp: EnrollTotpResult;
  /** Revoke an API key owned by the token's organization by setting its expiration. The key and its audit trail are retained; use `deleteOrganizationApiKey` to remove it. */
  expireOrganizationApiKey: ExpireOrganizationApiKeyResult;
  /** Revoke a user-scoped API key by setting its expiration. The key and its audit trail are retained; use `deleteUserApiKey` to remove it. */
  expireUserApiKey: ExpireUserApiKeyResult;
  /** Invite a user to the organization the token was issued for, assigning a role and sending the invitation email. */
  inviteUser: InviteUserResult;
  /** Begin passkey (WebAuthn) registration for the authenticated user by returning the credential creation options. This is step 1 of the registration ceremony; complete it with `verifyPasskey`. */
  registerPasskey: RegisterPasskeyResult;
  /** Remove a member from the organization the token was issued for. */
  removeMember: RemoveMemberResult;
  /** Delete all TOTP factors for the authenticated user, effectively resetting MFA. */
  removeMfaFactor: RemoveMfaFactorResult;
  /** Resend a pending, expired, or revoked invitation for the organization the token was issued for. If the original invitation has expired or been revoked, a new invitation is created with the same role. */
  resendInvitation: ResendInvitationResult;
  /** Restart verification for a domain belonging to the token's organization. */
  reverifyOrganizationDomain: OrganizationDomain;
  /** Revokes all active sessions for the authenticated user except the current one and, if provided, `input.currentSessionId`. */
  revokeAllSessions: RevokeAllSessionsResult;
  /** Revoke a pending invitation for the organization the token was issued for. */
  revokeInvitation: RevokeInvitationResult;
  /** Revokes a specific session by ID. */
  revokeSession: RevokeSessionResult;
  /** Sends a verification code to the new email address. Requires an elevated access token from `verifyCurrentEmail`. The user must confirm with the code via `confirmEmailChange`. */
  sendEmailChange: SendEmailChangeResult;
  /** Sends a verification code to the user's current email address to prove ownership before changing email. */
  sendVerificationCode: SendVerificationCodeResult;
  /** Write a data provider's configuration for the token's organization: whether the organization's members can connect it, the scopes it requests, the organization's own OAuth client credentials, and any non-secret configuration values the provider declares. Fields left out are unchanged. Supersedes `setDataProviderEnabled` for anything beyond toggling `enabled`. */
  setDataProviderConfiguration: SetDataProviderConfigurationResult;
  /** Enable or disable a data provider for the token's organization. Disabling it hides the data provider from the organization's users and stops new connections; existing connections stay readable so they can be disconnected. */
  setDataProviderEnabled: DataProvider;
  /** Write an organization-owned data provider's configuration for the token's organization: whether the organization's shared connection is enabled, the scopes it requests, the organization's own OAuth client credentials, and any non-secret configuration values the provider declares. Fields left out are unchanged. */
  setOrganizationDataProviderConfiguration: SetDataProviderConfigurationResult;
  /** Update the label of one of the authenticated user's exact connections in the token's organization scope, without changing credentials or identity. Duplicate labels produce advisory warnings, not errors. */
  updateDataProviderConnectionLabel: UpdateDataProviderConnectionLabelResult;
  /** Update an organization member's roles within the organization the token was issued for. When multiple roles are enabled, all provided role slugs are assigned; otherwise only the first is used. */
  updateMemberRole: UpdateMemberRoleResult;
  /** Update the label of one of the token organization's exact shared connections without changing credentials or identity. Requires organization connection write permission; session users must be active members. Duplicate labels produce advisory warnings, not errors. */
  updateOrganizationDataProviderConnectionLabel: UpdateDataProviderConnectionLabelResult;
  /** Change the password for the authenticated user. Requires the current password for verification and validates the new password against the environment password policy. */
  updatePassword: UpdatePasswordResult;
  /** Updates the authenticated user's profile (first name, last name, locale). */
  updateProfile: UpdateProfileResult;
  /** Update a role belonging to the organization the token was issued for. */
  updateRole: Role;
  /** Update an SSO connection belonging to the token’s organization. */
  updateSsoConnection: Connection;
  /** Verifies the code sent to the current email address. Returns an elevated access token required for `sendEmailChange` and `confirmEmailChange`. */
  verifyCurrentEmail: VerifyCurrentEmailResult;
  /** Complete passkey (WebAuthn) registration by verifying the credential created by the authenticator. This is step 2 of the registration ceremony started by `registerPasskey`. */
  verifyPasskey: VerifyPasskeyResult;
  /** Confirm TOTP enrollment by verifying a code from the authenticator app. Marks the factor as verified. */
  verifyTotp: VerifyTotpResult;
};

export type MutationAssignPermissionToRoleArgs = {
  input: AssignPermissionToRoleInput;
};

export type MutationConfirmEmailChangeArgs = {
  input: ConfirmEmailChangeInput;
};

export type MutationConnectDataProviderWithClientCredentialsArgs = {
  input: ConnectDataProviderWithClientCredentialsInput;
};

export type MutationConnectOrganizationDataProviderWithClientCredentialsArgs = {
  input: ConnectOrganizationDataProviderWithClientCredentialsInput;
};

export type MutationCreateAdminPortalLinkArgs = {
  intent: AdminPortalLinkIntent;
};

export type MutationCreateAuditLogExportArgs = {
  input: CreateAuditLogExportInput;
};

export type MutationCreateDataProviderAuthorizationArgs = {
  input: CreateDataProviderAuthorizationInput;
};

export type MutationCreateDataProviderConnectionArgs = {
  input: CreateDataProviderConnectionInput;
};

export type MutationCreateOrganizationApiKeyArgs = {
  input: CreateApiKeyInput;
};

export type MutationCreateOrganizationDataProviderAuthorizationArgs = {
  input: CreateOrganizationDataProviderAuthorizationInput;
};

export type MutationCreateOrganizationDataProviderConnectionArgs = {
  input: CreateOrganizationDataProviderConnectionInput;
};

export type MutationCreateOrganizationDomainArgs = {
  domain: Scalars["String"]["input"];
};

export type MutationCreatePasswordArgs = {
  input: CreatePasswordInput;
};

export type MutationCreateRoleArgs = {
  input: CreateRoleInput;
};

export type MutationCreateSsoConnectionArgs = {
  input: CreateSsoConnectionInput;
};

export type MutationCreateUserApiKeyArgs = {
  input: CreateApiKeyInput;
};

export type MutationDeleteDataProviderConnectionArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteOrganizationApiKeyArgs = {
  apiKeyId: Scalars["ID"]["input"];
};

export type MutationDeleteOrganizationDataProviderConnectionArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteOrganizationDomainArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeletePasskeyArgs = {
  input: DeletePasskeyInput;
};

export type MutationDeleteRoleArgs = {
  input: DeleteRoleInput;
};

export type MutationDeleteSsoConnectionArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteUserApiKeyArgs = {
  apiKeyId: Scalars["ID"]["input"];
};

export type MutationEnrollTotpArgs = {
  input: EnrollTotpInput;
};

export type MutationExpireOrganizationApiKeyArgs = {
  input: ExpireApiKeyInput;
};

export type MutationExpireUserApiKeyArgs = {
  input: ExpireApiKeyInput;
};

export type MutationInviteUserArgs = {
  input: InviteUserInput;
};

export type MutationRegisterPasskeyArgs = {
  input: RegisterPasskeyInput;
};

export type MutationRemoveMemberArgs = {
  input: RemoveMemberInput;
};

export type MutationRemoveMfaFactorArgs = {
  input: RemoveMfaFactorInput;
};

export type MutationResendInvitationArgs = {
  input: ResendInvitationInput;
};

export type MutationReverifyOrganizationDomainArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationRevokeAllSessionsArgs = {
  input?: InputMaybe<RevokeAllSessionsInput>;
};

export type MutationRevokeInvitationArgs = {
  input: RevokeInvitationInput;
};

export type MutationRevokeSessionArgs = {
  input: RevokeSessionInput;
};

export type MutationSendEmailChangeArgs = {
  input: SendEmailChangeInput;
};

export type MutationSetDataProviderConfigurationArgs = {
  input: SetDataProviderConfigurationInput;
};

export type MutationSetDataProviderEnabledArgs = {
  input: SetDataProviderEnabledInput;
};

export type MutationSetOrganizationDataProviderConfigurationArgs = {
  input: SetOrganizationDataProviderConfigurationInput;
};

export type MutationUpdateDataProviderConnectionLabelArgs = {
  input: UpdateDataProviderConnectionLabelInput;
};

export type MutationUpdateMemberRoleArgs = {
  input: UpdateMemberRoleInput;
};

export type MutationUpdateOrganizationDataProviderConnectionLabelArgs = {
  input: UpdateDataProviderConnectionLabelInput;
};

export type MutationUpdatePasswordArgs = {
  input: UpdatePasswordInput;
};

export type MutationUpdateProfileArgs = {
  input: UpdateProfileInput;
};

export type MutationUpdateRoleArgs = {
  input: UpdateRoleInput;
};

export type MutationUpdateSsoConnectionArgs = {
  input: UpdateSsoConnectionInput;
};

export type MutationVerifyCurrentEmailArgs = {
  input: VerifyCurrentEmailInput;
};

export type MutationVerifyPasskeyArgs = {
  input: VerifyPasskeyInput;
};

export type MutationVerifyTotpArgs = {
  input: VerifyTotpInput;
};

export type NoAuditEventsFound = {
  __typename?: "NoAuditEventsFound";
  message: Scalars["String"]["output"];
};

/** The user has no TOTP factors to remove. */
export type NoMfaFactorsEnrolled = {
  __typename?: "NoMfaFactorsEnrolled";
  _placeholder: Scalars["Boolean"]["output"];
};

/** There is no pending email change to confirm. */
export type NoPendingEmailChange = {
  __typename?: "NoPendingEmailChange";
  message: Scalars["String"]["output"];
};

/** OAuth provider for a connected account. */
export type OAuthProvider =
  | "AppleOAuth"
  | "BitbucketOAuth"
  | "DiscordOAuth"
  | "GitLabOAuth"
  | "GithubOAuth"
  | "GoogleOAuth"
  | "GrokOAuth"
  | "IntuitOAuth"
  | "LinkedInOAuth"
  | "MicrosoftOAuth"
  | "SalesforceOAuth"
  | "SlackOAuth"
  | "VercelMarketplaceOAuth"
  | "VercelOAuth"
  | "XOAuth"
  | "XeroOAuth";

/** An organization in the current environment. */
export type Organization = {
  __typename?: "Organization";
  /** Whether the organization allows profiles outside the organization domains. */
  allowProfilesOutsideOrganization: Scalars["Boolean"]["output"];
  createdAt: Scalars["DateTime"]["output"];
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
  updatedAt: Scalars["DateTime"]["output"];
};

/** An API key owned by the organization the token was issued for. A tenant-level credential: it is not tied to any user. */
export type OrganizationApiKey = {
  __typename?: "OrganizationApiKey";
  createdAt: Scalars["DateTime"]["output"];
  /** When the key expires. A key with an expiration in the past is revoked and can no longer authenticate. */
  expiresAt?: Maybe<Scalars["DateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  /** When the key was last used to authenticate, if ever. */
  lastUsedAt?: Maybe<Scalars["DateTime"]["output"]>;
  /** The human-readable name of the key. */
  name: Scalars["String"]["output"];
  /** A redacted form of the secret, safe to display. The secret itself is only ever returned when the key is created. */
  obfuscatedValue: Scalars["String"]["output"];
  /** The permission slugs the key carries. */
  permissions: Array<Scalars["String"]["output"]>;
  updatedAt: Scalars["DateTime"]["output"];
};

/** The organization API key was created. */
export type OrganizationApiKeyCreated = {
  __typename?: "OrganizationApiKeyCreated";
  apiKey: OrganizationApiKey;
  /** The plaintext secret, returned exactly once at creation. It is never retrievable again — no query or other mutation returns it. */
  value: Scalars["String"]["output"];
};

/** The expiration of the organization API key was updated. The key is retained. */
export type OrganizationApiKeyExpired = {
  __typename?: "OrganizationApiKeyExpired";
  apiKey: OrganizationApiKey;
};

export type OrganizationApiKeyList = {
  __typename?: "OrganizationApiKeyList";
  data: Array<OrganizationApiKey>;
  listMetadata: ListMetadata;
};

/** This organization is not allowed to send invites. */
export type OrganizationBlockedFromSendingInvites = {
  __typename?: "OrganizationBlockedFromSendingInvites";
  /** Placeholder field to allow an empty @ObjectType. */
  _placeholder?: Maybe<Scalars["Boolean"]["output"]>;
};

/** A data provider the token's organization connects on behalf of all its members. */
export type OrganizationDataProvider = {
  __typename?: "OrganizationDataProvider";
  authMethods: Array<Scalars["String"]["output"]>;
  /** Every scope the organization may request. Only populated for providers where the organization brings its own OAuth credentials; empty otherwise. */
  availableScopes: Array<Scalars["String"]["output"]>;
  /** The actions the organization may take on this data provider right now. */
  capabilities: OrganizationDataProviderCapabilities;
  /** The non-secret configuration values pinned for the token's organization (or by the developer, for a provider whose credentials the developer manages). */
  config: Array<DataProviderConfigEntry>;
  /** The configuration fields the provider declares. */
  configFields: Array<DataProviderConfigField>;
  /** Whether the provider can be connected: always true when the developer manages the OAuth application, otherwise true once the organization has supplied a full credential pair. */
  configured: Scalars["Boolean"]["output"];
  /** Every shared connection the organization holds to this data provider, in creation order. */
  connectedAccounts: Array<DataProviderConnection>;
  /** The organization's sole shared connection, when it has exactly one. Use `connectedAccounts` when several may exist. */
  connection?: Maybe<DataProviderConnection>;
  createdAt: Scalars["DateTime"]["output"];
  /** The redacted OAuth application credentials configured for the token's organization, seeding the credentials dialog. */
  credentials: DataProviderCredentials;
  /** Who supplies the OAuth application: `shared` (WorkOS), `custom` (the developer), or `organization` (the organization itself). */
  credentialsType: Scalars["String"]["output"];
  /** The scopes the developer configured, before any organization override. */
  defaultScopes: Array<Scalars["String"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  /** Who disabled the provider when `enabled` is false: `developer` (the environment) or `organization` (the organization override). Null while enabled. */
  disabledSource?: Maybe<Scalars["String"]["output"]>;
  enabled: Scalars["Boolean"]["output"];
  /** Whether the organization has supplied its own OAuth client credentials for this data provider. Always false for a provider whose credentials the developer manages. */
  hasCredentials: Scalars["Boolean"]["output"];
  /** The URL of the provider logo for dark backgrounds, when one is served. */
  iconDarkUrl?: Maybe<Scalars["String"]["output"]>;
  /** The slug of the provider's icon in the widget icon set. Falls back to the provider type. */
  iconSlug?: Maybe<Scalars["String"]["output"]>;
  /** The URL of the provider logo for light backgrounds, when one is served. */
  iconUrl?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  integrationType: Scalars["String"]["output"];
  name: Scalars["String"]["output"];
  scopes?: Maybe<Array<Scalars["String"]["output"]>>;
  slug: Scalars["String"]["output"];
  state: Scalars["String"]["output"];
  updatedAt: Scalars["DateTime"]["output"];
};

/** The actions the token's organization may take on a data provider right now. */
export type OrganizationDataProviderCapabilities = {
  __typename?: "OrganizationDataProviderCapabilities";
  /** The auth methods currently available to this token for explicit Add: oauth, api_key, or client_credentials. Interactive OAuth requires a member session. Empty exactly when canAddConnection is false. */
  addConnectionMethods: Array<Scalars["String"]["output"]>;
  /** Whether an explicit Add is available for this provider and owner. Counts all connections, not a page of results. The server rechecks before creating. */
  canAddConnection: Scalars["Boolean"]["output"];
  /** Whether the organization may change the configuration of the data provider. */
  canConfigure: Scalars["Boolean"]["output"];
  /** Whether the organization may fill the compatibility slot. This can remain true at the additional-connection cap; use canAddConnection for explicit Add. */
  canConnect: Scalars["Boolean"]["output"];
  /** Whether the organization may disconnect a shared connection. */
  canDisconnect: Scalars["Boolean"]["output"];
  /** Whether the compatibility connection needs and supports reauthorization. Use each connectedAccounts row's capabilities for exact-target actions. */
  canReauthorize: Scalars["Boolean"]["output"];
  /** Whether the compatibility connection's API key or client credentials may be replaced. Use each connectedAccounts row's capabilities for exact-target actions. */
  canUpdateCredentials: Scalars["Boolean"]["output"];
};

export type OrganizationDataProviderList = {
  __typename?: "OrganizationDataProviderList";
  data: Array<OrganizationDataProvider>;
  listMetadata: ListMetadata;
};

/** A domain belonging to the organization the token was issued for. */
export type OrganizationDomain = {
  __typename?: "OrganizationDomain";
  createdAt: Scalars["DateTime"]["output"];
  /** The fully qualified domain name. */
  domain: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  /** The DNS name server provider detected for the domain. */
  nameServer: DomainVerificationNameServer;
  organizationId: Scalars["ID"]["output"];
  state: OrganizationDomainState;
  /** The subdomain portion of the domain, if any. */
  subdomain?: Maybe<Scalars["String"]["output"]>;
  /** The DNS record prefix the customer must add to verify the domain. */
  verificationPrefix?: Maybe<Scalars["String"]["output"]>;
  /** The DNS record value the customer must add to verify the domain. */
  verificationToken?: Maybe<Scalars["String"]["output"]>;
};

export type OrganizationDomainList = {
  __typename?: "OrganizationDomainList";
  data: Array<OrganizationDomain>;
  listMetadata: ListMetadata;
};

/** The verification state of an organization domain. */
export type OrganizationDomainState =
  "Failed" | "LegacyVerified" | "Pending" | "Verified";

/** An invitation to join the organization the token was issued for. */
export type OrganizationInvitation = {
  __typename?: "OrganizationInvitation";
  createdAt: Scalars["DateTime"]["output"];
  /** The email address the invitation was sent to. */
  email: Scalars["String"]["output"];
  /** When the invitation expires. */
  expiresAt: Scalars["DateTime"]["output"];
  /** The ID of the invitation. */
  id: Scalars["ID"]["output"];
  /** Slug of the role the invitee will be granted on acceptance, if any. */
  roleSlug?: Maybe<Scalars["String"]["output"]>;
  status: OrganizationInvitationStatus;
};

export type OrganizationInvitationStatus =
  "Accepted" | "Expired" | "Pending" | "Revoked";

/** An organization member — a user with their membership status and assigned roles. */
export type OrganizationMember = {
  __typename?: "OrganizationMember";
  /** The actions the calling user may take on this member. Computed relative to the caller: empty for the caller themselves and for members whose permissions exceed the caller’s. */
  actions: Array<OrganizationMemberAction>;
  createdAt: Scalars["DateTime"]["output"];
  email: Scalars["String"]["output"];
  emailVerified: Scalars["Boolean"]["output"];
  firstName?: Maybe<Scalars["String"]["output"]>;
  /** The user ID of the member. */
  id: Scalars["ID"]["output"];
  /** Whether this member is the calling user. */
  isCurrentUser: Scalars["Boolean"]["output"];
  /** Whether this member is provisioned by a directory. Directory-managed memberships cannot be revoked. */
  isDirectoryManaged: Scalars["Boolean"]["output"];
  /** Timestamp of the member's most recent session activity. */
  lastActivityAt?: Maybe<Scalars["DateTime"]["output"]>;
  lastName?: Maybe<Scalars["String"]["output"]>;
  profilePictureUrl?: Maybe<Scalars["String"]["output"]>;
  roles: Array<OrganizationMemberRole>;
  status: OrganizationMemberStatus;
};

/** An action the calling user is allowed to take on an organization member. */
export type OrganizationMemberAction =
  "EditRole" | "ResendInvite" | "RevokeInvite" | "RevokeMembership";

/** A paginated list of organization members. */
export type OrganizationMemberList = {
  __typename?: "OrganizationMemberList";
  data: Array<OrganizationMember>;
  listMetadata: ListMetadata;
};

/** A role assigned to an organization member. */
export type OrganizationMemberRole = {
  __typename?: "OrganizationMemberRole";
  name: Scalars["String"]["output"];
  slug: Scalars["String"]["output"];
};

export type OrganizationMemberStatus =
  "Active" | "InviteExpired" | "InviteRevoked" | "Invited" | "NoInvite";

/** Enum represents the pagination order. */
export type PaginationOrder = "Asc" | "Desc" | "Normal";

/** A registered passkey (WebAuthn credential) for the authenticated user. */
export type Passkey = {
  __typename?: "Passkey";
  createdAt: Scalars["DateTime"]["output"];
  id: Scalars["ID"]["output"];
  /** When this passkey was last used to authenticate. */
  lastVerifiedAt?: Maybe<Scalars["DateTime"]["output"]>;
  updatedAt: Scalars["DateTime"]["output"];
};

/** The registration challenge was not found. Challenges are single-use and expire after a few minutes; restart registration. */
export type PasskeyChallengeNotFound = {
  __typename?: "PasskeyChallengeNotFound";
  _placeholder: Scalars["Boolean"]["output"];
};

/** The passkey was deleted successfully. */
export type PasskeyDeleted = {
  __typename?: "PasskeyDeleted";
  success: Scalars["Boolean"]["output"];
};

/** No passkey with the given ID belongs to the authenticated user. */
export type PasskeyNotFound = {
  __typename?: "PasskeyNotFound";
  _placeholder: Scalars["Boolean"]["output"];
};

/** The WebAuthn credential creation options to pass to the browser, plus the challenge ID to send back with the attestation in `verifyPasskey`. */
export type PasskeyRegistrationOptions = {
  __typename?: "PasskeyRegistrationOptions";
  /** The server-side challenge ID. Pass it to `verifyPasskey` together with the attestation response. */
  challengeId: Scalars["String"]["output"];
  /** The WebAuthn PublicKeyCredentialCreationOptionsJSON to pass to navigator.credentials.create(). */
  options: Scalars["JSON"]["output"];
};

/** The WebAuthn attestation response failed verification. */
export type PasskeyVerificationFailed = {
  __typename?: "PasskeyVerificationFailed";
  _placeholder: Scalars["Boolean"]["output"];
};

/** The passkey was verified and registered successfully. */
export type PasskeyVerified = {
  __typename?: "PasskeyVerified";
  success: Scalars["Boolean"]["output"];
};

/** The types of characters in a password. */
export type PasswordCharacterType =
  "Lowercase" | "Number" | "Symbol" | "Uppercase";

/** The password was created successfully. */
export type PasswordCreated = {
  __typename?: "PasswordCreated";
  success: Scalars["Boolean"]["output"];
};

/** The password requirements configured for the environment. Use these to describe the requirements before a password is submitted; `createPassword` and `updatePassword` enforce them. */
export type PasswordPolicy = {
  __typename?: "PasswordPolicy";
  /** The minimum number of characters. */
  minimumLength: Scalars["Int"]["output"];
  /** The minimum zxcvbn strength score (0–4) a password must reach. */
  minimumStrength: Scalars["Int"]["output"];
  /** Whether passwords found in known data breaches are rejected. */
  rejectsBreachedPasswords: Scalars["Boolean"]["output"];
  /** Whether a lowercase letter is required. */
  requiresLowercase: Scalars["Boolean"]["output"];
  /** Whether a number is required. */
  requiresNumber: Scalars["Boolean"]["output"];
  /** Whether a special character is required. */
  requiresSymbol: Scalars["Boolean"]["output"];
  /** Whether an uppercase letter is required. */
  requiresUppercase: Scalars["Boolean"]["output"];
};

/** The provided password does not meet the environment password policy requirements. */
export type PasswordPolicyViolation = {
  __typename?: "PasswordPolicyViolation";
  /** A machine-readable error code. Matches the `code` of the first entry in `violations`. */
  code: Scalars["String"]["output"];
  /** A human-readable description of the policy violation. Describes the first entry in `violations`. */
  message: Scalars["String"]["output"];
  /** Every way in which the password failed the policy, so all of them can be surfaced at once. */
  violations: Array<PasswordViolation>;
};

/** The password was updated successfully. */
export type PasswordUpdated = {
  __typename?: "PasswordUpdated";
  success: Scalars["Boolean"]["output"];
};

/** A single way in which a password failed the environment password policy. Fields other than `code` and `message` are only populated for the codes that carry them. */
export type PasswordViolation = {
  __typename?: "PasswordViolation";
  /** For a missing `Symbol` character type, the symbols that satisfy the requirement. */
  allowedSymbols?: Maybe<Scalars["String"]["output"]>;
  /** For `password_pwned`, how many times the password appears in known data breaches. */
  breachOccurrences?: Maybe<Scalars["Int"]["output"]>;
  /** For `password_missing_character_type`, the class of character that is missing. */
  characterType?: Maybe<PasswordCharacterType>;
  /** A machine-readable error code, e.g. `password_too_short`, `password_missing_character_type`, `password_pwned`, `password_reused`, `password_too_weak`, `password_contains_email`, `password_too_long`. */
  code: Scalars["String"]["output"];
  /** For `password_too_long`, the allowed maximum length. */
  maximumLength?: Maybe<Scalars["Int"]["output"]>;
  /** A human-readable description of this violation. */
  message: Scalars["String"]["output"];
  /** For `password_too_short`, the required minimum length. */
  minimumLength?: Maybe<Scalars["Int"]["output"]>;
  /** For `password_too_weak`, suggestions for choosing a stronger password. Empty for other codes. */
  strengthSuggestions: Array<Scalars["String"]["output"]>;
  /** For `password_too_weak`, a summary of why it is weak. */
  strengthWarning?: Maybe<Scalars["String"]["output"]>;
};

/** A permission that can be granted to a role within the environment. */
export type Permission = {
  __typename?: "Permission";
  /** The kinds of API key this permission may be granted to, in enum order. Empty when it cannot be granted to any API key. */
  apiKeyOwnerTypes: Array<ApiKeyOwnerType>;
  createdAt: Scalars["DateTime"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
  slug: Scalars["String"]["output"];
  /** Whether this is a WorkOS-managed system permission that cannot be modified. */
  system: Scalars["Boolean"]["output"];
  updatedAt: Scalars["DateTime"]["output"];
};

export type PermissionFilterInput = {
  /** Only return permissions that may be granted to this type of API key. */
  apiKeyOwnerType?: InputMaybe<ApiKeyOwnerType>;
  /** When true, only return permissions the calling user effectively holds in the token's organization. This is the same set the API key create mutations validate against, so combining it with `apiKeyOwnerType` yields exactly the permissions the caller may grant to a new key. Tokens that do not act as an organization member (credential tokens, standalone widget sessions) receive an empty list. */
  heldByCaller?: InputMaybe<Scalars["Boolean"]["input"]>;
};

export type PermissionList = {
  __typename?: "PermissionList";
  data: Array<Permission>;
  listMetadata: ListMetadata;
};

/** The profile was updated successfully. */
export type ProfileUpdated = {
  __typename?: "ProfileUpdated";
  user: User;
};

export type Query = {
  __typename?: "Query";
  auditEvent: AuditEvent;
  auditEvents: AuditEventList;
  auditLogExport: AuditLogExport;
  /** The audit log stream destination configured for the token's organization, or null when no stream is configured. */
  auditLogStream?: Maybe<AuditLogStream>;
  /** The authentication methods the environment allows and the password policy it enforces. Requires a session token. */
  authenticationSettings: AuthenticationSettings;
  /** The AuthKit settings for the token's environment. */
  authkitSettings: AuthKitSettings;
  /** The branding the token renders: its application's own once that application has been customized, otherwise its environment's. */
  branding: Branding;
  /** Placeholder query for the Client GraphQL API scaffold. Returns a static value and is replaced by real resolvers. */
  clientApiStatus: Scalars["String"]["output"];
  /** List the data providers the token's organization can configure for its members, with the organization's current configuration of each. */
  configurableDataProviders: ConfigurableDataProviderList;
  /** Return a data provider by ID within the token's environment. */
  dataProvider: DataProvider;
  /** Report whether an authorization attempt is still outstanding. Poll this with the `state` returned when the authorization was created while the popup is open; it flips to `connecting: false` once the provider callback has been handled or the attempt expired. */
  dataProviderAuthorizationStatus: DataProviderAuthorizationStatus;
  /** Return one of the authenticated user's data provider connections by ID. */
  dataProviderConnection: DataProviderConnection;
  /** List the authenticated user's data provider connections, including their status. */
  dataProviderConnections: DataProviderConnectionList;
  /** List the data providers configured in the token's environment. */
  dataProviders: DataProviderList;
  /** Return a Directory Sync connection by ID within the token's organization. */
  directoryConnection: Directory;
  /** List the Directory Sync connections for the token's organization. */
  directoryConnections: DirectoryList;
  /** List the groups of a Directory Sync connection. */
  directoryGroups: DirectoryGroupList;
  /** List the users of a Directory Sync connection. */
  directoryUsers: DirectoryUserList;
  /** The permissions a user effectively has in the organization the token was issued for, including permissions inherited through the user's roles. Callers may read their own effective permissions; reading another member's requires the elevated user:read grant. */
  effectivePermissions: Array<Permission>;
  /** The feature flags that evaluate to enabled for a user in the environment the token was issued for, including flags targeted at the token's organization. Flags absent from the list evaluate to false. Callers may evaluate their own flags; evaluating another member of the token's organization requires the elevated user:read grant. */
  evaluatedFlags: FlagList;
  /** Fetch a feature flag by ID from the project that owns the token's environment. */
  flag: Flag;
  /** Fetch a feature flag by slug from the project that owns the token's environment. */
  flagBySlug: Flag;
  /** List the feature flags of the project that owns the token's environment, with their state in that environment. */
  flags: FlagList;
  /** Returns the currently authenticated user (the subject of the token). */
  me: User;
  /** Returns an organization by ID within the token's environment. */
  organization: Organization;
  /** List the active API keys owned by the token's organization. Secrets are never included. */
  organizationApiKeys: OrganizationApiKeyList;
  /** List the data providers the token's organization connects on behalf of all its members, with the organization's shared connection when it has one. */
  organizationDataProviders: OrganizationDataProviderList;
  /** Return a domain by ID within the token's organization, including its verification status. */
  organizationDomain: OrganizationDomain;
  /** List the domains belonging to the organization the token was issued for. */
  organizationDomains: OrganizationDomainList;
  /** List members of the organization the token was issued for, with their roles. */
  organizationMemberships: OrganizationMemberList;
  /** List organizations the authenticated user belongs to. */
  organizations: Array<UserOrganization>;
  /** List registered passkeys for the authenticated user. Requires a session token. */
  passkeys: Array<Passkey>;
  /** List the permissions defined in the environment the token was issued for. */
  permissions: PermissionList;
  /** Fetch a single role available to the organization the token was issued for. */
  role?: Maybe<Role>;
  /** List roles available to the organization the token was issued for, with role assignment configuration. */
  roles: RolesResult;
  /** List active sessions for the authenticated user. Requires a session token. */
  sessions: Array<Session>;
  /** List the data providers the token's organization has connected for all its members, with the shared connections the caller may use. Available to any active member of the organization. */
  sharedDataProviders: SharedDataProviderList;
  /** Returns an SSO connection by ID, including its IdP setup status, provided it belongs to the token's organization. */
  ssoConnection: Connection;
  /** List the SSO connections belonging to the organization the token was issued for. */
  ssoConnections: Array<Connection>;
  /** Returns a user by ID, provided they are a member of the token's organization. */
  user: User;
  /** List the active user-scoped API keys in the token's organization. Returns only the token user's own keys unless the token holds the organization-wide user API key grant. Secrets are never included. */
  userApiKeys: UserApiKeyList;
};

export type QueryAuditEventArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryAuditEventsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  filter: AuditEventFilterInput;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
};

export type QueryAuditLogExportArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryConfigurableDataProvidersArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
};

export type QueryDataProviderArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryDataProviderAuthorizationStatusArgs = {
  dataProviderId: Scalars["ID"]["input"];
  state: Scalars["String"]["input"];
};

export type QueryDataProviderConnectionArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryDataProviderConnectionsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
};

export type QueryDataProvidersArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
};

export type QueryDirectoryConnectionArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryDirectoryConnectionsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  search?: InputMaybe<Scalars["String"]["input"]>;
};

export type QueryDirectoryGroupsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  directoryId: Scalars["ID"]["input"];
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
};

export type QueryDirectoryUsersArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  directoryId: Scalars["ID"]["input"];
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
};

export type QueryEffectivePermissionsArgs = {
  userId: Scalars["ID"]["input"];
};

export type QueryEvaluatedFlagsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  userId: Scalars["ID"]["input"];
};

export type QueryFlagArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryFlagBySlugArgs = {
  slug: Scalars["String"]["input"];
};

export type QueryFlagsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  search?: InputMaybe<Scalars["String"]["input"]>;
};

export type QueryOrganizationArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryOrganizationApiKeysArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  search?: InputMaybe<Scalars["String"]["input"]>;
};

export type QueryOrganizationDataProvidersArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
};

export type QueryOrganizationDomainArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryOrganizationDomainsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
};

export type QueryOrganizationMembershipsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  roleSlug?: InputMaybe<Scalars["String"]["input"]>;
  search?: InputMaybe<Scalars["String"]["input"]>;
};

export type QueryPermissionsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  filter?: InputMaybe<PermissionFilterInput>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  search?: InputMaybe<Scalars["String"]["input"]>;
};

export type QueryRoleArgs = {
  id: Scalars["ID"]["input"];
};

export type QuerySharedDataProvidersArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  supportsMultipleConnections?: InputMaybe<Scalars["Boolean"]["input"]>;
};

export type QuerySsoConnectionArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryUserArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryUserApiKeysArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  search?: InputMaybe<Scalars["String"]["input"]>;
};

/** Input for beginning passkey (WebAuthn) registration. */
export type RegisterPasskeyInput = {
  /** An elevated access token obtained by verifying the current email address. Required to prove recent re-authentication. */
  elevatedAccessToken: Scalars["String"]["input"];
};

export type RegisterPasskeyResult =
  | ElevatedAccessTokenExpired
  | ElevatedAccessTokenInvalid
  | PasskeyRegistrationOptions;

export type RemoveMemberInput = {
  /** The user ID of the member to remove. */
  userId: Scalars["ID"]["input"];
};

export type RemoveMemberResult =
  MemberIsManagedByDirectory | MemberNotFound | MemberRemoved;

/** Input for removing all TOTP factors. */
export type RemoveMfaFactorInput = {
  /** An elevated access token obtained by verifying the current email address. Required to prove recent re-authentication. */
  elevatedAccessToken: Scalars["String"]["input"];
};

export type RemoveMfaFactorResult =
  | ElevatedAccessTokenExpired
  | ElevatedAccessTokenInvalid
  | MfaFactorRemoved
  | NoMfaFactorsEnrolled;

export type ResendInvitationInput = {
  /** The ID of the user whose invitation should be resent. */
  userId: Scalars["ID"]["input"];
};

/** No invitation exists for this user in this organization. */
export type ResendInvitationNotFound = {
  __typename?: "ResendInvitationNotFound";
  userId: Scalars["ID"]["output"];
};

export type ResendInvitationResult =
  | InvitationResent
  | InviteeAlreadyAccepted
  | InviteeEmailNotDeliverable
  | ResendInvitationNotFound;

/** Input for revoking all sessions. */
export type RevokeAllSessionsInput = {
  /** The ID of the session to keep active in addition to the session the request was authenticated with. Use this when the token is not itself a user session. Ignored unless it is one of the authenticated user’s own active sessions. */
  currentSessionId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type RevokeAllSessionsResult = AllSessionsRevoked;

export type RevokeInvitationInput = {
  /** The ID of the user whose pending invitation should be revoked. */
  userId: Scalars["ID"]["input"];
};

export type RevokeInvitationResult =
  InvitationNotFound | InvitationNotPending | InvitationRevoked;

/** Input for revoking a specific session. */
export type RevokeSessionInput = {
  /** The ID of the session to revoke. */
  sessionId: Scalars["ID"]["input"];
};

export type RevokeSessionResult = SessionNotFound | SessionRevoked;

/** A role available within the organization. */
export type Role = {
  __typename?: "Role";
  createdAt: Scalars["DateTime"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  /** Whether this is the default role assigned to new members. */
  isDefault: Scalars["Boolean"]["output"];
  name: Scalars["String"]["output"];
  slug: Scalars["String"]["output"];
  updatedAt: Scalars["DateTime"]["output"];
};

/** Confirms that a role has been scheduled for deletion. */
export type RoleDeleted = {
  __typename?: "RoleDeleted";
  /** The ID of the deleted role. */
  id: Scalars["ID"]["output"];
};

/** No active roles with the given slugs exist in the environment. */
export type RoleNotFound = {
  __typename?: "RoleNotFound";
  /** The role slugs that did not resolve to active roles. */
  roleSlugs: Array<Scalars["String"]["output"]>;
};

/** Roles available in the organization along with role assignment configuration. */
export type RolesResult = {
  __typename?: "RolesResult";
  /** Whether members can be assigned multiple roles simultaneously. */
  multipleRolesEnabled: Scalars["Boolean"]["output"];
  roles: Array<Role>;
};

/** Input for requesting an email change verification code. */
export type SendEmailChangeInput = {
  /** The elevated access token from a successful `verifyCurrentEmail` call. */
  elevatedAccessToken: Scalars["String"]["input"];
  /** The new email address to change to. */
  newEmail: Scalars["String"]["input"];
};

export type SendEmailChangeResult =
  | DailyEmailQuotaExceeded
  | EmailChangeNotAvailable
  | EmailChangeSent
  | EmailManagedByProvider
  | EmailNotAvailable
  | IdentityVerificationExpired
  | IdentityVerificationInvalid
  | InvalidEmail;

export type SendVerificationCodeResult =
  DailyEmailQuotaExceeded | VerificationCodeSent;

/** An active user session. */
export type Session = {
  __typename?: "Session";
  createdAt: Scalars["DateTime"]["output"];
  currentLocation?: Maybe<SessionLocation>;
  id: Scalars["ID"]["output"];
  ipAddress?: Maybe<Scalars["String"]["output"]>;
  /** Whether this session is the one making the request. */
  isCurrent: Scalars["Boolean"]["output"];
  lastActivityAt?: Maybe<Scalars["DateTime"]["output"]>;
  organizationId?: Maybe<Scalars["String"]["output"]>;
  state: SessionState;
  updatedAt: Scalars["DateTime"]["output"];
  userAgent?: Maybe<Scalars["String"]["output"]>;
};

/** Approximate geographic location derived from the session IP. */
export type SessionLocation = {
  __typename?: "SessionLocation";
  cityName: Scalars["String"]["output"];
  countryISOCode: Scalars["String"]["output"];
};

/** No session was found with the given ID. */
export type SessionNotFound = {
  __typename?: "SessionNotFound";
  /** The session ID that did not resolve to a session. */
  sessionId: Scalars["ID"]["output"];
};

/** The session was revoked successfully. */
export type SessionRevoked = {
  __typename?: "SessionRevoked";
  session: Session;
};

/** The lifecycle state of a session. */
export type SessionState = {
  __typename?: "SessionState";
  expiresAt?: Maybe<Scalars["DateTime"]["output"]>;
  /** Session state: Issued, Revoked, etc. */
  tag: Scalars["String"]["output"];
};

export type SetDataProviderConfigurationInput = {
  /** The organization's own OAuth client ID. Must be supplied together with `clientSecret`. */
  clientId?: InputMaybe<Scalars["String"]["input"]>;
  /** The organization's own OAuth client secret. Write-only: it is stored encrypted and never returned; clients read `hasCredentials` instead. */
  clientSecret?: InputMaybe<Scalars["String"]["input"]>;
  /** Non-secret configuration values declared by the provider. */
  config?: InputMaybe<Array<DataProviderConfigEntryInput>>;
  /** The data provider to configure for the token's organization. Configuration always applies to the token's organization; it cannot be set for another one. */
  dataProviderId: Scalars["ID"]["input"];
  /** Whether the organization's users can see and connect the data provider. */
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  /** The scopes the organization requests. Only providers where the organization brings its own OAuth credentials may widen beyond the defaults. */
  scopes?: InputMaybe<Array<Scalars["String"]["input"]>>;
};

export type SetDataProviderConfigurationResult =
  DataProviderConfigInvalid | DataProviderConfiguration;

export type SetDataProviderEnabledInput = {
  dataProviderId: Scalars["ID"]["input"];
  /** Whether the data provider is available to the organization the token was issued for. */
  enabled: Scalars["Boolean"]["input"];
};

export type SetOrganizationDataProviderConfigurationInput = {
  /** The organization's own OAuth client ID. Must be supplied together with `clientSecret`. */
  clientId?: InputMaybe<Scalars["String"]["input"]>;
  /** The organization's own OAuth client secret. Write-only: it is stored encrypted and never returned; clients read `hasCredentials` instead. */
  clientSecret?: InputMaybe<Scalars["String"]["input"]>;
  /** Non-secret configuration values declared by the provider. */
  config?: InputMaybe<Array<DataProviderConfigEntryInput>>;
  /** The organization-owned data provider to configure (`organizationDataProviders`). Configuration always applies to the token's organization; it cannot be set for another one. */
  dataProviderId: Scalars["ID"]["input"];
  /** Whether the organization's shared connection to the data provider is enabled. */
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  /** The scopes the organization requests. Only providers where the organization brings its own OAuth credentials may widen beyond the defaults. */
  scopes?: InputMaybe<Array<Scalars["String"]["input"]>>;
};

/** A data provider the token's organization has connected on behalf of all its members, with the shared connections a member may use. */
export type SharedDataProvider = {
  __typename?: "SharedDataProvider";
  /** The organization's shared connections to the provider that the caller may use. Never empty: providers without a usable shared connection are not listed. */
  connectedAccounts: Array<SharedDataProviderConnection>;
  createdAt: Scalars["DateTime"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  /** The URL of the provider's icon for dark backgrounds. */
  iconDarkUrl?: Maybe<Scalars["String"]["output"]>;
  /** The slug of the icon the widget displays for the provider. */
  iconSlug?: Maybe<Scalars["String"]["output"]>;
  /** The URL of the provider's icon. */
  iconUrl?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  /** The provider type this data provider was created from. */
  integrationType: Scalars["String"]["output"];
  /** The display name of the provider. */
  name: Scalars["String"]["output"];
  /** The stable identifier for the provider. */
  slug: Scalars["String"]["output"];
  updatedAt: Scalars["DateTime"]["output"];
};

/** One of the organization's shared connections to a data provider, as visible to any active member. */
export type SharedDataProviderConnection = {
  __typename?: "SharedDataProviderConnection";
  /** How the connection authenticates: `oauth`, `api_key`, or `client_credentials`. */
  authMethod: Scalars["String"]["output"];
  /** Whether the connection can be used right now: `available`, or `needs_admin_attention` when an admin must re-authorize it first. */
  availability: Scalars["String"]["output"];
  /** Whether this is the compatibility connection or a standard connection. */
  connectionRole: DataInstallationConnectionRole;
  createdAt: Scalars["DateTime"]["output"];
  /** The data provider this connection was created for. */
  dataProviderId: Scalars["ID"]["output"];
  /** The slug of the connected data provider. */
  dataProviderSlug: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  /** The status of the connection: `connected` or `needs_reauthorization`. */
  state: Scalars["String"]["output"];
  updatedAt: Scalars["DateTime"]["output"];
};

export type SharedDataProviderList = {
  __typename?: "SharedDataProviderList";
  data: Array<SharedDataProvider>;
  listMetadata: ListMetadata;
};

/** A sign-in session initiated through an SSO connection. Mirrors the session exposed by the Widgets SSO connections API. */
export type SsoConnectionSession = {
  __typename?: "SsoConnectionSession";
  createdAt: Scalars["DateTime"]["output"];
  id: Scalars["ID"]["output"];
  /** The state the session reached. */
  state: SsoSessionState;
};

/** The protocol family (SAML or OpenID Connect) of an SSO connection. */
export type SsoProviderTag = "OpenIdConnect" | "Saml";

/** The state an SSO sign-in session reached. */
export type SsoSessionState =
  | "Authorized"
  | "Failed"
  | "Started"
  | "Successful"
  | "Terminated"
  | "Timedout";

/** The user already has a verified TOTP factor enrolled. */
export type TotpAlreadyEnrolled = {
  __typename?: "TotpAlreadyEnrolled";
  _placeholder: Scalars["Boolean"]["output"];
};

/** TOTP factor details returned after enrollment. */
export type TotpFactor = {
  __typename?: "TotpFactor";
  /** The authentication challenge ID. */
  authenticationChallengeId: Scalars["String"]["output"];
  /** The authentication factor ID. */
  authenticationFactorId: Scalars["String"]["output"];
  /** A data-URI PNG of the QR code. */
  qrCode: Scalars["String"]["output"];
  /** The TOTP secret for manual entry. */
  secret: Scalars["String"]["output"];
  /** The TOTP URI for provisioning (otpauth://…). */
  uri: Scalars["String"]["output"];
};

/** The TOTP verification code was invalid. */
export type TotpVerificationFailed = {
  __typename?: "TotpVerificationFailed";
  _placeholder: Scalars["Boolean"]["output"];
};

/** The TOTP verification succeeded and the factor is active. */
export type TotpVerified = {
  __typename?: "TotpVerified";
  success: Scalars["Boolean"]["output"];
};

export type UpdateDataProviderConnectionLabelInput = {
  /** A non-unique label of at most 255 Unicode code points, preserved exactly. Omit to preserve the current label; null clears it. Does not change the account identifier. */
  accountDisplayName?: InputMaybe<Scalars["String"]["input"]>;
  /** The exact connection to rename. No other connection is selected if this ID is missing or out of scope. */
  id: Scalars["ID"]["input"];
};

export type UpdateDataProviderConnectionLabelResult = {
  __typename?: "UpdateDataProviderConnectionLabelResult";
  /** The updated connection. Credentials, identity, connection role, and state are unchanged. */
  connection: DataProviderConnection;
  /** Advisory warnings for the supplied label. Empty when no label was supplied or no exact duplicate exists for this provider and owner. */
  warnings: Array<DataProviderConnectionLabelWarning>;
};

export type UpdateMemberRoleInput = {
  /** Slugs of the roles to assign. When multiple roles are enabled for the environment, all provided roles are assigned; otherwise only the first slug is used. */
  roleSlugs: Array<Scalars["String"]["input"]>;
  /** The user ID of the member to update. */
  userId: Scalars["ID"]["input"];
};

export type UpdateMemberRoleResult =
  MemberNotFound | MemberRoleUpdated | RoleNotFound;

/** Input for changing an existing password. Requires the current password for verification. */
export type UpdatePasswordInput = {
  /** The current password for verification. */
  currentPassword: Scalars["String"]["input"];
  /** The new password. Must satisfy the environment password policy. */
  newPassword: Scalars["String"]["input"];
};

export type UpdatePasswordResult =
  IncorrectPassword | PasswordPolicyViolation | PasswordUpdated;

/** Input for updating the authenticated user's profile. */
export type UpdateProfileInput = {
  /** The user's first name. Pass an empty string to clear. */
  firstName?: InputMaybe<Scalars["String"]["input"]>;
  /** The user's last name. Pass an empty string to clear. */
  lastName?: InputMaybe<Scalars["String"]["input"]>;
  /** The user's locale as a BCP 47 language tag (e.g. 'en-US'). Pass an empty string to clear. */
  locale?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateProfileResult = InvalidLocale | ProfileUpdated;

export type UpdateRoleInput = {
  /** Human-readable description of the role. This is a full replace of the role, so an omitted or null description clears it — resupply the current value to preserve it. */
  description?: InputMaybe<Scalars["String"]["input"]>;
  /** The ID of the role to update. */
  id: Scalars["ID"]["input"];
  /** Human-readable name for the role. */
  name: Scalars["String"]["input"];
  /** Slugs of the permissions granted to the role. Replaces the existing set when provided. */
  permissions?: InputMaybe<Array<Scalars["String"]["input"]>>;
};

export type UpdateSsoConnectionInput = {
  id: Scalars["ID"]["input"];
  /** A new human-readable name for the connection. */
  name?: InputMaybe<Scalars["String"]["input"]>;
};

/** A user in the current environment. */
export type User = {
  __typename?: "User";
  connectedAccounts: Array<ConnectedAccount>;
  createdAt: Scalars["DateTime"]["output"];
  email: Scalars["String"]["output"];
  emailVerified: Scalars["Boolean"]["output"];
  firstName?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  lastName?: Maybe<Scalars["String"]["output"]>;
  /** Whether multi-factor authentication (TOTP) is set up for this user. Always `false` when the environment has MFA turned off — use `authenticationSettings.mfaEnabled` to tell the two apart. Only populated on `me`. */
  mfaEnabled: Scalars["Boolean"]["output"];
  /** When MFA was last used to authenticate. Only populated on `me`. */
  mfaLastUsedAt?: Maybe<Scalars["DateTime"]["output"]>;
  /** When a password was last used to authenticate. Only populated on `me`. */
  passwordLastUsedAt?: Maybe<Scalars["DateTime"]["output"]>;
  /** Whether this user has a password set. Reflects the user regardless of whether the environment allows password authentication; use `authenticationSettings.passwordAuthEnabled` for that. Only populated on `me`. */
  passwordSet: Scalars["Boolean"]["output"];
  profilePictureUrl?: Maybe<Scalars["String"]["output"]>;
  updatedAt: Scalars["DateTime"]["output"];
};

/** The user already has a password set. */
export type UserAlreadyHasPassword = {
  __typename?: "UserAlreadyHasPassword";
  _placeholder: Scalars["Boolean"]["output"];
};

/** An API key owned by a member of the token's organization. A user-scoped key acts as that user, so it is never interchangeable with an organization API key. */
export type UserApiKey = {
  __typename?: "UserApiKey";
  createdAt: Scalars["DateTime"]["output"];
  /** When the key expires. A key with an expiration in the past is revoked and can no longer authenticate. */
  expiresAt?: Maybe<Scalars["DateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  /** When the key was last used to authenticate, if ever. */
  lastUsedAt?: Maybe<Scalars["DateTime"]["output"]>;
  /** The human-readable name of the key. */
  name: Scalars["String"]["output"];
  /** A redacted form of the secret, safe to display. The secret itself is only ever returned when the key is created. */
  obfuscatedValue: Scalars["String"]["output"];
  owner: UserApiKeyOwner;
  /** The permission slugs the key carries. */
  permissions: Array<Scalars["String"]["output"]>;
  updatedAt: Scalars["DateTime"]["output"];
};

/** The user-scoped API key was created. */
export type UserApiKeyCreated = {
  __typename?: "UserApiKeyCreated";
  apiKey: UserApiKey;
  /** The plaintext secret, returned exactly once at creation. It is never retrievable again — no query or other mutation returns it. */
  value: Scalars["String"]["output"];
};

/** The expiration of the user-scoped API key was updated. The key is retained. */
export type UserApiKeyExpired = {
  __typename?: "UserApiKeyExpired";
  apiKey: UserApiKey;
};

export type UserApiKeyList = {
  __typename?: "UserApiKeyList";
  data: Array<UserApiKey>;
  listMetadata: ListMetadata;
};

/** The userland user a user-scoped API key belongs to. */
export type UserApiKeyOwner = {
  __typename?: "UserApiKeyOwner";
  /** The owner's display name, falling back to their email when they have no name. */
  displayName: Scalars["String"]["output"];
  email: Scalars["String"]["output"];
  firstName?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  lastName?: Maybe<Scalars["String"]["output"]>;
};

/** The invitation was created and the email sent. */
export type UserInvited = {
  __typename?: "UserInvited";
  invitation: OrganizationInvitation;
};

/** An organization the authenticated user belongs to, with a flag indicating whether it is the token's current organization. */
export type UserOrganization = {
  __typename?: "UserOrganization";
  id: Scalars["ID"]["output"];
  /** Whether this is the organization the token is currently scoped to. */
  isCurrent: Scalars["Boolean"]["output"];
  name: Scalars["String"]["output"];
};

/** The verification code has expired. */
export type VerificationCodeExpired = {
  __typename?: "VerificationCodeExpired";
  message: Scalars["String"]["output"];
};

/** The verification code is incorrect. */
export type VerificationCodeIncorrect = {
  __typename?: "VerificationCodeIncorrect";
  message: Scalars["String"]["output"];
};

/** The verification code has already been used. */
export type VerificationCodePreviouslyUsed = {
  __typename?: "VerificationCodePreviouslyUsed";
  message: Scalars["String"]["output"];
};

/** A verification code was sent to the current email address for identity verification. */
export type VerificationCodeSent = {
  __typename?: "VerificationCodeSent";
  /** The authentication challenge ID to use in subsequent steps. */
  authenticationChallengeId: Scalars["ID"]["output"];
  /** When the verification code expires. */
  expiresAt: Scalars["DateTime"]["output"];
};

/** Too many verification code attempts. */
export type VerificationTooManyAttempts = {
  __typename?: "VerificationTooManyAttempts";
  message: Scalars["String"]["output"];
};

/** Input for verifying the current email address. */
export type VerifyCurrentEmailInput = {
  /** The authentication challenge ID returned from `sendVerificationCode`. */
  authenticationChallengeId: Scalars["ID"]["input"];
  /** The verification code sent to the current email address. */
  code: Scalars["String"]["input"];
};

export type VerifyCurrentEmailResult =
  | CurrentEmailVerified
  | VerificationCodeExpired
  | VerificationCodeIncorrect
  | VerificationCodePreviouslyUsed
  | VerificationTooManyAttempts;

/** Input for completing passkey (WebAuthn) registration by verifying the attestation created by the authenticator. */
export type VerifyPasskeyInput = {
  /** The challenge ID returned by `registerPasskey`. */
  challengeId: Scalars["String"]["input"];
  /** An elevated access token obtained by verifying the current email address. Required to prove recent re-authentication. */
  elevatedAccessToken: Scalars["String"]["input"];
  /** The WebAuthn RegistrationResponseJSON returned by navigator.credentials.create(). */
  response: Scalars["JSON"]["input"];
};

export type VerifyPasskeyResult =
  | ElevatedAccessTokenExpired
  | ElevatedAccessTokenInvalid
  | PasskeyChallengeNotFound
  | PasskeyVerificationFailed
  | PasskeyVerified;

/** Input for verifying a TOTP enrollment. */
export type VerifyTotpInput = {
  /** The authentication challenge ID from enrollTotp. */
  authenticationChallengeId: Scalars["String"]["input"];
  /** The TOTP code from the authenticator app. */
  code: Scalars["String"]["input"];
  /** An elevated access token obtained by verifying the current email address. Required to prove recent re-authentication. */
  elevatedAccessToken: Scalars["String"]["input"];
};

export type VerifyTotpResult =
  | ElevatedAccessTokenExpired
  | ElevatedAccessTokenInvalid
  | TotpVerificationFailed
  | TotpVerified;

/** An X.509 certificate registered on a SAML connection. Mirrors the certificate exposed by the Widgets SSO connections API. */
export type X509Certificate = {
  __typename?: "X509Certificate";
  id: Scalars["ID"]["output"];
  /** When an expiry notification was last sent for this certificate. */
  lastExpiryEventSentAt?: Maybe<Scalars["DateTime"]["output"]>;
  /** The end of the certificate validity period. */
  notAfter?: Maybe<Scalars["DateTime"]["output"]>;
  /** The start of the certificate validity period. */
  notBefore?: Maybe<Scalars["DateTime"]["output"]>;
  /** The PEM-encoded certificate. */
  value: Scalars["String"]["output"];
};

export type ClientApiStatusQueryVariables = Exact<{ [key: string]: never }>;

export type ClientApiStatusQuery = {
  __typename?: "Query";
  clientApiStatus: string;
};

export type OrganizationDomainFieldsFragment = {
  __typename?: "OrganizationDomain";
  id: string;
  organizationId: string;
  domain: string;
  subdomain?: string | null;
  state: OrganizationDomainState;
  verificationPrefix?: string | null;
  verificationToken?: string | null;
  nameServer: DomainVerificationNameServer;
  createdAt: string;
};

export type ListOrganizationDomainsQueryVariables = Exact<{
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
}>;

export type ListOrganizationDomainsQuery = {
  __typename?: "Query";
  organizationDomains: {
    __typename?: "OrganizationDomainList";
    data: Array<{
      __typename?: "OrganizationDomain";
      id: string;
      organizationId: string;
      domain: string;
      subdomain?: string | null;
      state: OrganizationDomainState;
      verificationPrefix?: string | null;
      verificationToken?: string | null;
      nameServer: DomainVerificationNameServer;
      createdAt: string;
    }>;
    listMetadata: {
      __typename?: "ListMetadata";
      after?: string | null;
      before?: string | null;
    };
  };
};

export type CreateOrganizationDomainMutationVariables = Exact<{
  domain: Scalars["String"]["input"];
}>;

export type CreateOrganizationDomainMutation = {
  __typename?: "Mutation";
  createOrganizationDomain: {
    __typename?: "OrganizationDomain";
    id: string;
    organizationId: string;
    domain: string;
    subdomain?: string | null;
    state: OrganizationDomainState;
    verificationPrefix?: string | null;
    verificationToken?: string | null;
    nameServer: DomainVerificationNameServer;
    createdAt: string;
  };
};

export type DeleteOrganizationDomainMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type DeleteOrganizationDomainMutation = {
  __typename?: "Mutation";
  deleteOrganizationDomain: {
    __typename?: "OrganizationDomain";
    id: string;
    organizationId: string;
    domain: string;
    subdomain?: string | null;
    state: OrganizationDomainState;
    verificationPrefix?: string | null;
    verificationToken?: string | null;
    nameServer: DomainVerificationNameServer;
    createdAt: string;
  };
};

export type ReverifyOrganizationDomainMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type ReverifyOrganizationDomainMutation = {
  __typename?: "Mutation";
  reverifyOrganizationDomain: {
    __typename?: "OrganizationDomain";
    id: string;
    organizationId: string;
    domain: string;
    subdomain?: string | null;
    state: OrganizationDomainState;
    verificationPrefix?: string | null;
    verificationToken?: string | null;
    nameServer: DomainVerificationNameServer;
    createdAt: string;
  };
};

export type UserFieldsFragment = {
  __typename?: "User";
  id: string;
  email: string;
  emailVerified: boolean;
  firstName?: string | null;
  lastName?: string | null;
  profilePictureUrl?: string | null;
  mfaEnabled: boolean;
  mfaLastUsedAt?: string | null;
  passwordSet: boolean;
  passwordLastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConnectedAccountFieldsFragment = {
  __typename?: "ConnectedAccount";
  id: string;
  provider: OAuthProvider;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profilePictureUrl?: string | null;
  lastLoginAt?: string | null;
};

export type PasswordViolationFieldsFragment = {
  __typename?: "PasswordViolation";
  code: string;
  message: string;
  characterType?: PasswordCharacterType | null;
  minimumLength?: number | null;
  maximumLength?: number | null;
  allowedSymbols?: string | null;
  breachOccurrences?: number | null;
  strengthWarning?: string | null;
  strengthSuggestions: Array<string>;
};

export type MeQueryVariables = Exact<{ [key: string]: never }>;

export type MeQuery = {
  __typename?: "Query";
  me: {
    __typename?: "User";
    id: string;
    email: string;
    emailVerified: boolean;
    firstName?: string | null;
    lastName?: string | null;
    profilePictureUrl?: string | null;
    mfaEnabled: boolean;
    mfaLastUsedAt?: string | null;
    passwordSet: boolean;
    passwordLastUsedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    connectedAccounts: Array<{
      __typename?: "ConnectedAccount";
      id: string;
      provider: OAuthProvider;
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      profilePictureUrl?: string | null;
      lastLoginAt?: string | null;
    }>;
  };
};

export type AuthenticationSettingsQueryVariables = Exact<{
  [key: string]: never;
}>;

export type AuthenticationSettingsQuery = {
  __typename?: "Query";
  authenticationSettings: {
    __typename?: "AuthenticationSettings";
    mfaEnabled: boolean;
    mfaRequired: boolean;
    passkeyAuthEnabled: boolean;
    passwordAuthEnabled: boolean;
    passwordPolicy: {
      __typename?: "PasswordPolicy";
      minimumLength: number;
      minimumStrength: number;
      rejectsBreachedPasswords: boolean;
      requiresLowercase: boolean;
      requiresNumber: boolean;
      requiresSymbol: boolean;
      requiresUppercase: boolean;
    };
  };
};

export type PasskeysQueryVariables = Exact<{ [key: string]: never }>;

export type PasskeysQuery = {
  __typename?: "Query";
  passkeys: Array<{
    __typename?: "Passkey";
    id: string;
    createdAt: string;
    updatedAt: string;
    lastVerifiedAt?: string | null;
  }>;
};

export type UpdateProfileMutationVariables = Exact<{
  input: UpdateProfileInput;
}>;

export type UpdateProfileMutation = {
  __typename?: "Mutation";
  updateProfile:
    | { __typename: "InvalidLocale" }
    | {
        __typename: "ProfileUpdated";
        user: {
          __typename?: "User";
          id: string;
          email: string;
          emailVerified: boolean;
          firstName?: string | null;
          lastName?: string | null;
          profilePictureUrl?: string | null;
          mfaEnabled: boolean;
          mfaLastUsedAt?: string | null;
          passwordSet: boolean;
          passwordLastUsedAt?: string | null;
          createdAt: string;
          updatedAt: string;
        };
      };
};

export type SendVerificationCodeMutationVariables = Exact<{
  [key: string]: never;
}>;

export type SendVerificationCodeMutation = {
  __typename?: "Mutation";
  sendVerificationCode:
    | { __typename: "DailyEmailQuotaExceeded" }
    | {
        __typename: "VerificationCodeSent";
        authenticationChallengeId: string;
        expiresAt: string;
      };
};

export type VerifyCurrentEmailMutationVariables = Exact<{
  input: VerifyCurrentEmailInput;
}>;

export type VerifyCurrentEmailMutation = {
  __typename?: "Mutation";
  verifyCurrentEmail:
    | {
        __typename: "CurrentEmailVerified";
        elevatedAccessToken: string;
        expiresAt: string;
      }
    | { __typename: "VerificationCodeExpired" }
    | { __typename: "VerificationCodeIncorrect" }
    | { __typename: "VerificationCodePreviouslyUsed" }
    | { __typename: "VerificationTooManyAttempts" };
};

export type SendEmailChangeMutationVariables = Exact<{
  input: SendEmailChangeInput;
}>;

export type SendEmailChangeMutation = {
  __typename?: "Mutation";
  sendEmailChange:
    | { __typename: "DailyEmailQuotaExceeded" }
    | { __typename: "EmailChangeNotAvailable" }
    | { __typename: "EmailChangeSent"; expiresAt: string }
    | { __typename: "EmailManagedByProvider" }
    | { __typename: "EmailNotAvailable" }
    | { __typename: "IdentityVerificationExpired" }
    | { __typename: "IdentityVerificationInvalid" }
    | { __typename: "InvalidEmail" };
};

export type ConfirmEmailChangeMutationVariables = Exact<{
  input: ConfirmEmailChangeInput;
}>;

export type ConfirmEmailChangeMutation = {
  __typename?: "Mutation";
  confirmEmailChange:
    | { __typename: "EmailChangeCodeExpired" }
    | { __typename: "EmailChangeCodeIncorrect" }
    | { __typename: "EmailChangeCodePreviouslyUsed" }
    | {
        __typename: "EmailChangeConfirmed";
        elevatedAccessToken: string;
        expiresAt: string;
        user: {
          __typename?: "User";
          id: string;
          email: string;
          emailVerified: boolean;
          firstName?: string | null;
          lastName?: string | null;
          profilePictureUrl?: string | null;
          mfaEnabled: boolean;
          mfaLastUsedAt?: string | null;
          passwordSet: boolean;
          passwordLastUsedAt?: string | null;
          createdAt: string;
          updatedAt: string;
        };
      }
    | { __typename: "EmailChangeTooManyAttempts" }
    | { __typename: "EmailManagedByProvider" }
    | { __typename: "EmailNotAvailable" }
    | { __typename: "IdentityVerificationExpired" }
    | { __typename: "IdentityVerificationInvalid" }
    | { __typename: "InvalidEmail" }
    | { __typename: "NoPendingEmailChange" };
};

export type CreatePasswordMutationVariables = Exact<{
  input: CreatePasswordInput;
}>;

export type CreatePasswordMutation = {
  __typename?: "Mutation";
  createPassword:
    | { __typename: "ElevatedAccessTokenExpired" }
    | { __typename: "ElevatedAccessTokenInvalid" }
    | { __typename: "PasswordCreated"; success: boolean }
    | {
        __typename: "PasswordPolicyViolation";
        code: string;
        message: string;
        violations: Array<{
          __typename?: "PasswordViolation";
          code: string;
          message: string;
          characterType?: PasswordCharacterType | null;
          minimumLength?: number | null;
          maximumLength?: number | null;
          allowedSymbols?: string | null;
          breachOccurrences?: number | null;
          strengthWarning?: string | null;
          strengthSuggestions: Array<string>;
        }>;
      }
    | { __typename: "UserAlreadyHasPassword" };
};

export type UpdatePasswordMutationVariables = Exact<{
  input: UpdatePasswordInput;
}>;

export type UpdatePasswordMutation = {
  __typename?: "Mutation";
  updatePassword:
    | { __typename: "IncorrectPassword" }
    | {
        __typename: "PasswordPolicyViolation";
        code: string;
        message: string;
        violations: Array<{
          __typename?: "PasswordViolation";
          code: string;
          message: string;
          characterType?: PasswordCharacterType | null;
          minimumLength?: number | null;
          maximumLength?: number | null;
          allowedSymbols?: string | null;
          breachOccurrences?: number | null;
          strengthWarning?: string | null;
          strengthSuggestions: Array<string>;
        }>;
      }
    | { __typename: "PasswordUpdated"; success: boolean };
};

export type EnrollTotpMutationVariables = Exact<{
  input: EnrollTotpInput;
}>;

export type EnrollTotpMutation = {
  __typename?: "Mutation";
  enrollTotp:
    | { __typename: "ElevatedAccessTokenExpired" }
    | { __typename: "ElevatedAccessTokenInvalid" }
    | { __typename: "TotpAlreadyEnrolled" }
    | {
        __typename: "TotpFactor";
        authenticationChallengeId: string;
        authenticationFactorId: string;
        secret: string;
        uri: string;
        qrCode: string;
      };
};

export type VerifyTotpMutationVariables = Exact<{
  input: VerifyTotpInput;
}>;

export type VerifyTotpMutation = {
  __typename?: "Mutation";
  verifyTotp:
    | { __typename: "ElevatedAccessTokenExpired" }
    | { __typename: "ElevatedAccessTokenInvalid" }
    | { __typename: "TotpVerificationFailed" }
    | { __typename: "TotpVerified"; success: boolean };
};

export type RemoveMfaFactorMutationVariables = Exact<{
  input: RemoveMfaFactorInput;
}>;

export type RemoveMfaFactorMutation = {
  __typename?: "Mutation";
  removeMfaFactor:
    | { __typename: "ElevatedAccessTokenExpired" }
    | { __typename: "ElevatedAccessTokenInvalid" }
    | { __typename: "MfaFactorRemoved"; success: boolean }
    | { __typename: "NoMfaFactorsEnrolled" };
};

export type SessionFieldsFragment = {
  __typename?: "Session";
  id: string;
  isCurrent: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
  organizationId?: string | null;
  lastActivityAt?: string | null;
  createdAt: string;
  updatedAt: string;
  state: {
    __typename?: "SessionState";
    tag: string;
    expiresAt?: string | null;
  };
  currentLocation?: {
    __typename?: "SessionLocation";
    cityName: string;
    countryISOCode: string;
  } | null;
};

export type SessionsQueryVariables = Exact<{ [key: string]: never }>;

export type SessionsQuery = {
  __typename?: "Query";
  sessions: Array<{
    __typename?: "Session";
    id: string;
    isCurrent: boolean;
    ipAddress?: string | null;
    userAgent?: string | null;
    organizationId?: string | null;
    lastActivityAt?: string | null;
    createdAt: string;
    updatedAt: string;
    state: {
      __typename?: "SessionState";
      tag: string;
      expiresAt?: string | null;
    };
    currentLocation?: {
      __typename?: "SessionLocation";
      cityName: string;
      countryISOCode: string;
    } | null;
  }>;
};

export type RevokeSessionMutationVariables = Exact<{
  input: RevokeSessionInput;
}>;

export type RevokeSessionMutation = {
  __typename?: "Mutation";
  revokeSession:
    | { __typename: "SessionNotFound" }
    | {
        __typename: "SessionRevoked";
        session: {
          __typename?: "Session";
          id: string;
          isCurrent: boolean;
          ipAddress?: string | null;
          userAgent?: string | null;
          organizationId?: string | null;
          lastActivityAt?: string | null;
          createdAt: string;
          updatedAt: string;
          state: {
            __typename?: "SessionState";
            tag: string;
            expiresAt?: string | null;
          };
          currentLocation?: {
            __typename?: "SessionLocation";
            cityName: string;
            countryISOCode: string;
          } | null;
        };
      };
};

export type RevokeAllSessionsMutationVariables = Exact<{
  input?: InputMaybe<RevokeAllSessionsInput>;
}>;

export type RevokeAllSessionsMutation = {
  __typename?: "Mutation";
  revokeAllSessions: { __typename: "AllSessionsRevoked"; success: boolean };
};

export type OrganizationMemberFieldsFragment = {
  __typename?: "OrganizationMember";
  id: string;
  email: string;
  emailVerified: boolean;
  firstName?: string | null;
  lastName?: string | null;
  profilePictureUrl?: string | null;
  status: OrganizationMemberStatus;
  lastActivityAt?: string | null;
  createdAt: string;
  actions: Array<OrganizationMemberAction>;
  isCurrentUser: boolean;
  isDirectoryManaged: boolean;
  roles: Array<{
    __typename?: "OrganizationMemberRole";
    slug: string;
    name: string;
  }>;
};

export type OrganizationInvitationFieldsFragment = {
  __typename?: "OrganizationInvitation";
  id: string;
  email: string;
  status: OrganizationInvitationStatus;
  roleSlug?: string | null;
  expiresAt: string;
  createdAt: string;
};

export type RoleFieldsFragment = {
  __typename?: "Role";
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ListOrganizationMembershipsQueryVariables = Exact<{
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  roleSlug?: InputMaybe<Scalars["String"]["input"]>;
  search?: InputMaybe<Scalars["String"]["input"]>;
}>;

export type ListOrganizationMembershipsQuery = {
  __typename?: "Query";
  organizationMemberships: {
    __typename?: "OrganizationMemberList";
    data: Array<{
      __typename?: "OrganizationMember";
      id: string;
      email: string;
      emailVerified: boolean;
      firstName?: string | null;
      lastName?: string | null;
      profilePictureUrl?: string | null;
      status: OrganizationMemberStatus;
      lastActivityAt?: string | null;
      createdAt: string;
      actions: Array<OrganizationMemberAction>;
      isCurrentUser: boolean;
      isDirectoryManaged: boolean;
      roles: Array<{
        __typename?: "OrganizationMemberRole";
        slug: string;
        name: string;
      }>;
    }>;
    listMetadata: {
      __typename?: "ListMetadata";
      after?: string | null;
      before?: string | null;
    };
  };
};

export type ListRolesQueryVariables = Exact<{ [key: string]: never }>;

export type ListRolesQuery = {
  __typename?: "Query";
  roles: {
    __typename?: "RolesResult";
    multipleRolesEnabled: boolean;
    roles: Array<{
      __typename?: "Role";
      id: string;
      slug: string;
      name: string;
      description?: string | null;
      isDefault: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
  };
};

export type InviteUserMutationVariables = Exact<{
  input: InviteUserInput;
}>;

export type InviteUserMutation = {
  __typename?: "Mutation";
  inviteUser:
    | { __typename: "InvalidInvitationExpiry" }
    | { __typename: "InvalidInviteeEmail" }
    | { __typename: "InvalidInviteeRole" }
    | { __typename: "InviteeAlreadyInvited" }
    | { __typename: "InviteeAlreadyMember" }
    | { __typename: "InviteeEmailNotDeliverable" }
    | { __typename: "OrganizationBlockedFromSendingInvites" }
    | {
        __typename: "UserInvited";
        invitation: {
          __typename?: "OrganizationInvitation";
          id: string;
          email: string;
          status: OrganizationInvitationStatus;
          roleSlug?: string | null;
          expiresAt: string;
          createdAt: string;
        };
      };
};

export type UpdateMemberRoleMutationVariables = Exact<{
  input: UpdateMemberRoleInput;
}>;

export type UpdateMemberRoleMutation = {
  __typename?: "Mutation";
  updateMemberRole:
    | { __typename: "MemberNotFound" }
    | {
        __typename: "MemberRoleUpdated";
        member: {
          __typename?: "OrganizationMember";
          id: string;
          email: string;
          emailVerified: boolean;
          firstName?: string | null;
          lastName?: string | null;
          profilePictureUrl?: string | null;
          status: OrganizationMemberStatus;
          lastActivityAt?: string | null;
          createdAt: string;
          actions: Array<OrganizationMemberAction>;
          isCurrentUser: boolean;
          isDirectoryManaged: boolean;
          roles: Array<{
            __typename?: "OrganizationMemberRole";
            slug: string;
            name: string;
          }>;
        };
      }
    | { __typename: "RoleNotFound"; roleSlugs: Array<string> };
};

export type RemoveMemberMutationVariables = Exact<{
  input: RemoveMemberInput;
}>;

export type RemoveMemberMutation = {
  __typename?: "Mutation";
  removeMember:
    | { __typename: "MemberIsManagedByDirectory" }
    | { __typename: "MemberNotFound" }
    | { __typename: "MemberRemoved"; userId: string };
};

export type ResendInvitationMutationVariables = Exact<{
  input: ResendInvitationInput;
}>;

export type ResendInvitationMutation = {
  __typename?: "Mutation";
  resendInvitation:
    | {
        __typename: "InvitationResent";
        invitation: {
          __typename?: "OrganizationInvitation";
          id: string;
          email: string;
          status: OrganizationInvitationStatus;
          roleSlug?: string | null;
          expiresAt: string;
          createdAt: string;
        };
      }
    | { __typename: "InviteeAlreadyAccepted" }
    | { __typename: "InviteeEmailNotDeliverable" }
    | { __typename: "ResendInvitationNotFound" };
};

export type RevokeInvitationMutationVariables = Exact<{
  input: RevokeInvitationInput;
}>;

export type RevokeInvitationMutation = {
  __typename?: "Mutation";
  revokeInvitation:
    | { __typename: "InvitationNotFound" }
    | { __typename: "InvitationNotPending" }
    | {
        __typename: "InvitationRevoked";
        invitation: {
          __typename?: "OrganizationInvitation";
          id: string;
          email: string;
          status: OrganizationInvitationStatus;
          roleSlug?: string | null;
          expiresAt: string;
          createdAt: string;
        };
      };
};

export type ListUserOrganizationsQueryVariables = Exact<{
  [key: string]: never;
}>;

export type ListUserOrganizationsQuery = {
  __typename?: "Query";
  organizations: Array<{
    __typename?: "UserOrganization";
    id: string;
    name: string;
    isCurrent: boolean;
  }>;
};

export type DirectoryFieldsFragment = {
  __typename?: "Directory";
  id: string;
  name: string;
  organizationId: string;
  externalKey: string;
  state: string;
  type: string;
  lastSyncRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: {
    __typename?: "DirectoryMetadata";
    groups: number;
    users: { __typename?: "DirectoryUsersMetadata"; active: number };
  };
};

export type ListDirectoryConnectionsQueryVariables = Exact<{
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  search?: InputMaybe<Scalars["String"]["input"]>;
}>;

export type ListDirectoryConnectionsQuery = {
  __typename?: "Query";
  directoryConnections: {
    __typename?: "DirectoryList";
    data: Array<{
      __typename?: "Directory";
      id: string;
      name: string;
      organizationId: string;
      externalKey: string;
      state: string;
      type: string;
      lastSyncRunAt?: string | null;
      createdAt: string;
      updatedAt: string;
      metadata: {
        __typename?: "DirectoryMetadata";
        groups: number;
        users: { __typename?: "DirectoryUsersMetadata"; active: number };
      };
    }>;
    listMetadata: {
      __typename?: "ListMetadata";
      after?: string | null;
      before?: string | null;
    };
  };
};

export type GetDirectoryConnectionQueryVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type GetDirectoryConnectionQuery = {
  __typename?: "Query";
  directoryConnection: {
    __typename?: "Directory";
    id: string;
    name: string;
    organizationId: string;
    externalKey: string;
    state: string;
    type: string;
    lastSyncRunAt?: string | null;
    createdAt: string;
    updatedAt: string;
    metadata: {
      __typename?: "DirectoryMetadata";
      groups: number;
      users: { __typename?: "DirectoryUsersMetadata"; active: number };
    };
  };
};

export type ConnectionFieldsFragment = {
  __typename?: "Connection";
  id: string;
  name: string;
  organizationId?: string | null;
  type: ConnectionType;
  providerTag: SsoProviderTag;
  state: ConnectionState;
  setupComplete: boolean;
  createdAt: string;
  updatedAt: string;
  lastSession?: {
    __typename?: "SsoConnectionSession";
    id: string;
    createdAt: string;
    state: SsoSessionState;
  } | null;
  latestExpiringCertificate?: {
    __typename?: "X509Certificate";
    id: string;
    notAfter?: string | null;
  } | null;
  latestExpiredCertificate?: {
    __typename?: "X509Certificate";
    id: string;
    notAfter?: string | null;
  } | null;
};

export type ListSsoConnectionsQueryVariables = Exact<{ [key: string]: never }>;

export type ListSsoConnectionsQuery = {
  __typename?: "Query";
  ssoConnections: Array<{
    __typename?: "Connection";
    id: string;
    name: string;
    organizationId?: string | null;
    type: ConnectionType;
    providerTag: SsoProviderTag;
    state: ConnectionState;
    setupComplete: boolean;
    createdAt: string;
    updatedAt: string;
    lastSession?: {
      __typename?: "SsoConnectionSession";
      id: string;
      createdAt: string;
      state: SsoSessionState;
    } | null;
    latestExpiringCertificate?: {
      __typename?: "X509Certificate";
      id: string;
      notAfter?: string | null;
    } | null;
    latestExpiredCertificate?: {
      __typename?: "X509Certificate";
      id: string;
      notAfter?: string | null;
    } | null;
  }>;
};

export type GetSsoConnectionQueryVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type GetSsoConnectionQuery = {
  __typename?: "Query";
  ssoConnection: {
    __typename?: "Connection";
    id: string;
    name: string;
    organizationId?: string | null;
    type: ConnectionType;
    providerTag: SsoProviderTag;
    state: ConnectionState;
    setupComplete: boolean;
    createdAt: string;
    updatedAt: string;
    lastSession?: {
      __typename?: "SsoConnectionSession";
      id: string;
      createdAt: string;
      state: SsoSessionState;
    } | null;
    latestExpiringCertificate?: {
      __typename?: "X509Certificate";
      id: string;
      notAfter?: string | null;
    } | null;
    latestExpiredCertificate?: {
      __typename?: "X509Certificate";
      id: string;
      notAfter?: string | null;
    } | null;
  };
};

export type DataProviderConfigFieldFieldsFragment = {
  __typename?: "DataProviderConfigField";
  key: string;
  label: string;
  required: boolean;
  scope: string;
  description?: string | null;
  example?: string | null;
  pattern?: string | null;
  patternFlags?: string | null;
  order?: number | null;
  secret?: boolean | null;
  default?: string | null;
};

export type DataProviderFieldsFragment = {
  __typename?: "DataProvider";
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  integrationType: string;
  authMethods: Array<string>;
  credentialsType: string;
  scopes?: Array<string> | null;
  state: string;
  enabled: boolean;
  iconSlug?: string | null;
  iconUrl?: string | null;
  iconDarkUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities: {
    __typename?: "DataProviderCapabilities";
    canAddConnection: boolean;
    addConnectionMethods: Array<string>;
  };
  configFields: Array<{
    __typename?: "DataProviderConfigField";
    key: string;
    label: string;
    required: boolean;
    scope: string;
    description?: string | null;
    example?: string | null;
    pattern?: string | null;
    patternFlags?: string | null;
    order?: number | null;
    secret?: boolean | null;
    default?: string | null;
  }>;
  config: Array<{
    __typename?: "DataProviderConfigEntry";
    name: string;
    value: string;
  }>;
};

export type DataProviderConnectionFieldsFragment = {
  __typename?: "DataProviderConnection";
  id: string;
  dataProviderId: string;
  dataProviderSlug: string;
  connectionRole: DataInstallationConnectionRole;
  accountIdentifier?: string | null;
  accountDisplayName?: string | null;
  authMethod: string;
  scopes: Array<string>;
  state: string;
  availability: string;
  apiKeyLast4?: string | null;
  clientId?: string | null;
  clientSecretLast4?: string | null;
  userId?: string | null;
  organizationId?: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities?: {
    __typename?: "DataProviderConnectionCapabilities";
    canReauthorize: boolean;
    canUpdateCredentials: boolean;
  } | null;
  config: Array<{
    __typename?: "DataProviderConfigEntry";
    name: string;
    value: string;
  }>;
};

export type ListDataProvidersQueryVariables = Exact<{
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
}>;

export type ListDataProvidersQuery = {
  __typename?: "Query";
  dataProviders: {
    __typename?: "DataProviderList";
    data: Array<{
      __typename?: "DataProvider";
      id: string;
      slug: string;
      name: string;
      description?: string | null;
      integrationType: string;
      authMethods: Array<string>;
      credentialsType: string;
      scopes?: Array<string> | null;
      state: string;
      enabled: boolean;
      iconSlug?: string | null;
      iconUrl?: string | null;
      iconDarkUrl?: string | null;
      createdAt: string;
      updatedAt: string;
      capabilities: {
        __typename?: "DataProviderCapabilities";
        canAddConnection: boolean;
        addConnectionMethods: Array<string>;
      };
      configFields: Array<{
        __typename?: "DataProviderConfigField";
        key: string;
        label: string;
        required: boolean;
        scope: string;
        description?: string | null;
        example?: string | null;
        pattern?: string | null;
        patternFlags?: string | null;
        order?: number | null;
        secret?: boolean | null;
        default?: string | null;
      }>;
      config: Array<{
        __typename?: "DataProviderConfigEntry";
        name: string;
        value: string;
      }>;
    }>;
    listMetadata: {
      __typename?: "ListMetadata";
      after?: string | null;
      before?: string | null;
    };
  };
};

export type ListDataProviderConnectionsQueryVariables = Exact<{
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
}>;

export type ListDataProviderConnectionsQuery = {
  __typename?: "Query";
  dataProviderConnections: {
    __typename?: "DataProviderConnectionList";
    data: Array<{
      __typename?: "DataProviderConnection";
      id: string;
      dataProviderId: string;
      dataProviderSlug: string;
      connectionRole: DataInstallationConnectionRole;
      accountIdentifier?: string | null;
      accountDisplayName?: string | null;
      authMethod: string;
      scopes: Array<string>;
      state: string;
      availability: string;
      apiKeyLast4?: string | null;
      clientId?: string | null;
      clientSecretLast4?: string | null;
      userId?: string | null;
      organizationId?: string | null;
      createdAt: string;
      updatedAt: string;
      capabilities?: {
        __typename?: "DataProviderConnectionCapabilities";
        canReauthorize: boolean;
        canUpdateCredentials: boolean;
      } | null;
      config: Array<{
        __typename?: "DataProviderConfigEntry";
        name: string;
        value: string;
      }>;
    }>;
    listMetadata: {
      __typename?: "ListMetadata";
      after?: string | null;
      before?: string | null;
    };
  };
};

export type CreateDataProviderConnectionMutationVariables = Exact<{
  input: CreateDataProviderConnectionInput;
}>;

export type CreateDataProviderConnectionMutation = {
  __typename?: "Mutation";
  createDataProviderConnection: {
    __typename?: "DataProviderConnection";
    id: string;
    dataProviderId: string;
    dataProviderSlug: string;
    connectionRole: DataInstallationConnectionRole;
    accountIdentifier?: string | null;
    accountDisplayName?: string | null;
    authMethod: string;
    scopes: Array<string>;
    state: string;
    availability: string;
    apiKeyLast4?: string | null;
    clientId?: string | null;
    clientSecretLast4?: string | null;
    userId?: string | null;
    organizationId?: string | null;
    createdAt: string;
    updatedAt: string;
    capabilities?: {
      __typename?: "DataProviderConnectionCapabilities";
      canReauthorize: boolean;
      canUpdateCredentials: boolean;
    } | null;
    config: Array<{
      __typename?: "DataProviderConfigEntry";
      name: string;
      value: string;
    }>;
  };
};

export type DeleteDataProviderConnectionMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type DeleteDataProviderConnectionMutation = {
  __typename?: "Mutation";
  deleteDataProviderConnection: string;
};

export type SetDataProviderEnabledMutationVariables = Exact<{
  input: SetDataProviderEnabledInput;
}>;

export type SetDataProviderEnabledMutation = {
  __typename?: "Mutation";
  setDataProviderEnabled: {
    __typename?: "DataProvider";
    id: string;
    slug: string;
    name: string;
    description?: string | null;
    integrationType: string;
    authMethods: Array<string>;
    credentialsType: string;
    scopes?: Array<string> | null;
    state: string;
    enabled: boolean;
    iconSlug?: string | null;
    iconUrl?: string | null;
    iconDarkUrl?: string | null;
    createdAt: string;
    updatedAt: string;
    capabilities: {
      __typename?: "DataProviderCapabilities";
      canAddConnection: boolean;
      addConnectionMethods: Array<string>;
    };
    configFields: Array<{
      __typename?: "DataProviderConfigField";
      key: string;
      label: string;
      required: boolean;
      scope: string;
      description?: string | null;
      example?: string | null;
      pattern?: string | null;
      patternFlags?: string | null;
      order?: number | null;
      secret?: boolean | null;
      default?: string | null;
    }>;
    config: Array<{
      __typename?: "DataProviderConfigEntry";
      name: string;
      value: string;
    }>;
  };
};

type DataProviderAuthorizationResultFields_DataProviderAuthorization_Fragment =
  {
    __typename: "DataProviderAuthorization";
    url: string;
    state: string;
    redirectToken: string;
    handoffToken?: string | null;
  };

type DataProviderAuthorizationResultFields_DataProviderAuthorizationUnavailable_Fragment =
  { __typename: "DataProviderAuthorizationUnavailable"; message: string };

type DataProviderAuthorizationResultFields_DataProviderConfigInvalid_Fragment =
  { __typename: "DataProviderConfigInvalid"; message: string };

export type DataProviderAuthorizationResultFieldsFragment =
  | DataProviderAuthorizationResultFields_DataProviderAuthorization_Fragment
  | DataProviderAuthorizationResultFields_DataProviderAuthorizationUnavailable_Fragment
  | DataProviderAuthorizationResultFields_DataProviderConfigInvalid_Fragment;

export type CreateDataProviderAuthorizationMutationVariables = Exact<{
  input: CreateDataProviderAuthorizationInput;
}>;

export type CreateDataProviderAuthorizationMutation = {
  __typename?: "Mutation";
  createDataProviderAuthorization:
    | {
        __typename: "DataProviderAuthorization";
        url: string;
        state: string;
        redirectToken: string;
        handoffToken?: string | null;
      }
    | { __typename: "DataProviderAuthorizationUnavailable"; message: string }
    | { __typename: "DataProviderConfigInvalid"; message: string };
};

export type CreateOrganizationDataProviderAuthorizationMutationVariables =
  Exact<{
    input: CreateOrganizationDataProviderAuthorizationInput;
  }>;

export type CreateOrganizationDataProviderAuthorizationMutation = {
  __typename?: "Mutation";
  createOrganizationDataProviderAuthorization:
    | {
        __typename: "DataProviderAuthorization";
        url: string;
        state: string;
        redirectToken: string;
        handoffToken?: string | null;
      }
    | { __typename: "DataProviderAuthorizationUnavailable"; message: string }
    | { __typename: "DataProviderConfigInvalid"; message: string };
};

export type DataProviderAuthorizationStatusQueryVariables = Exact<{
  dataProviderId: Scalars["ID"]["input"];
  state: Scalars["String"]["input"];
}>;

export type DataProviderAuthorizationStatusQuery = {
  __typename?: "Query";
  dataProviderAuthorizationStatus: {
    __typename?: "DataProviderAuthorizationStatus";
    state: string;
    connecting: boolean;
  };
};

export type ConnectDataProviderWithClientCredentialsMutationVariables = Exact<{
  input: ConnectDataProviderWithClientCredentialsInput;
}>;

export type ConnectDataProviderWithClientCredentialsMutation = {
  __typename?: "Mutation";
  connectDataProviderWithClientCredentials:
    | {
        __typename: "DataProviderAuthMethodUnsupported";
        authMethod: string;
        supportedAuthMethods: Array<string>;
      }
    | { __typename: "DataProviderConfigInvalid"; message: string }
    | {
        __typename: "DataProviderConnected";
        connection: {
          __typename?: "DataProviderConnection";
          id: string;
          dataProviderId: string;
          dataProviderSlug: string;
          connectionRole: DataInstallationConnectionRole;
          accountIdentifier?: string | null;
          accountDisplayName?: string | null;
          authMethod: string;
          scopes: Array<string>;
          state: string;
          availability: string;
          apiKeyLast4?: string | null;
          clientId?: string | null;
          clientSecretLast4?: string | null;
          userId?: string | null;
          organizationId?: string | null;
          createdAt: string;
          updatedAt: string;
          capabilities?: {
            __typename?: "DataProviderConnectionCapabilities";
            canReauthorize: boolean;
            canUpdateCredentials: boolean;
          } | null;
          config: Array<{
            __typename?: "DataProviderConfigEntry";
            name: string;
            value: string;
          }>;
        };
      }
    | {
        __typename: "DataProviderConnectionAuthMethodConflict";
        existingAuthMethod: string;
      };
};

export type DataProviderConfigurationFieldsFragment = {
  __typename?: "DataProviderConfiguration";
  dataProviderId: string;
  dataProviderSlug: string;
  organizationId: string;
  enabled: boolean;
  hasCredentials: boolean;
  scopes?: Array<string> | null;
  availableScopes: Array<string>;
  updatedAt: string;
  config: Array<{
    __typename?: "DataProviderConfigEntry";
    name: string;
    value: string;
  }>;
};

export type SetDataProviderConfigurationMutationVariables = Exact<{
  input: SetDataProviderConfigurationInput;
}>;

export type SetDataProviderConfigurationMutation = {
  __typename?: "Mutation";
  setDataProviderConfiguration:
    | { __typename: "DataProviderConfigInvalid"; message: string }
    | {
        __typename: "DataProviderConfiguration";
        dataProviderId: string;
        dataProviderSlug: string;
        organizationId: string;
        enabled: boolean;
        hasCredentials: boolean;
        scopes?: Array<string> | null;
        availableScopes: Array<string>;
        updatedAt: string;
        config: Array<{
          __typename?: "DataProviderConfigEntry";
          name: string;
          value: string;
        }>;
      };
};

export type ListOrganizationDataProvidersQueryVariables = Exact<{
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
}>;

export type ListOrganizationDataProvidersQuery = {
  __typename?: "Query";
  organizationDataProviders: {
    __typename?: "OrganizationDataProviderList";
    data: Array<{
      __typename?: "OrganizationDataProvider";
      id: string;
      slug: string;
      name: string;
      description?: string | null;
      integrationType: string;
      authMethods: Array<string>;
      credentialsType: string;
      scopes?: Array<string> | null;
      defaultScopes: Array<string>;
      availableScopes: Array<string>;
      state: string;
      enabled: boolean;
      disabledSource?: string | null;
      configured: boolean;
      hasCredentials: boolean;
      iconSlug?: string | null;
      iconUrl?: string | null;
      iconDarkUrl?: string | null;
      createdAt: string;
      updatedAt: string;
      credentials: {
        __typename?: "DataProviderCredentials";
        clientId?: string | null;
        credentialsType: string;
        hasCredentials: boolean;
        redactedClientSecret?: string | null;
        redirectUri: string;
      };
      capabilities: {
        __typename?: "OrganizationDataProviderCapabilities";
        canConfigure: boolean;
        canConnect: boolean;
        canDisconnect: boolean;
        canReauthorize: boolean;
        canUpdateCredentials: boolean;
        canAddConnection: boolean;
        addConnectionMethods: Array<string>;
      };
      configFields: Array<{
        __typename?: "DataProviderConfigField";
        key: string;
        label: string;
        required: boolean;
        scope: string;
        description?: string | null;
        example?: string | null;
        pattern?: string | null;
        patternFlags?: string | null;
        order?: number | null;
        secret?: boolean | null;
        default?: string | null;
      }>;
      config: Array<{
        __typename?: "DataProviderConfigEntry";
        name: string;
        value: string;
      }>;
      connection?: {
        __typename?: "DataProviderConnection";
        id: string;
        dataProviderId: string;
        dataProviderSlug: string;
        connectionRole: DataInstallationConnectionRole;
        accountIdentifier?: string | null;
        accountDisplayName?: string | null;
        authMethod: string;
        scopes: Array<string>;
        state: string;
        availability: string;
        apiKeyLast4?: string | null;
        clientId?: string | null;
        clientSecretLast4?: string | null;
        userId?: string | null;
        organizationId?: string | null;
        createdAt: string;
        updatedAt: string;
        capabilities?: {
          __typename?: "DataProviderConnectionCapabilities";
          canReauthorize: boolean;
          canUpdateCredentials: boolean;
        } | null;
        config: Array<{
          __typename?: "DataProviderConfigEntry";
          name: string;
          value: string;
        }>;
      } | null;
      connectedAccounts: Array<{
        __typename?: "DataProviderConnection";
        id: string;
        dataProviderId: string;
        dataProviderSlug: string;
        connectionRole: DataInstallationConnectionRole;
        accountIdentifier?: string | null;
        accountDisplayName?: string | null;
        authMethod: string;
        scopes: Array<string>;
        state: string;
        availability: string;
        apiKeyLast4?: string | null;
        clientId?: string | null;
        clientSecretLast4?: string | null;
        userId?: string | null;
        organizationId?: string | null;
        createdAt: string;
        updatedAt: string;
        capabilities?: {
          __typename?: "DataProviderConnectionCapabilities";
          canReauthorize: boolean;
          canUpdateCredentials: boolean;
        } | null;
        config: Array<{
          __typename?: "DataProviderConfigEntry";
          name: string;
          value: string;
        }>;
      }>;
    }>;
    listMetadata: {
      __typename?: "ListMetadata";
      after?: string | null;
      before?: string | null;
    };
  };
};

export type OrganizationDataProviderFieldsFragment = {
  __typename?: "OrganizationDataProvider";
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  integrationType: string;
  authMethods: Array<string>;
  credentialsType: string;
  scopes?: Array<string> | null;
  defaultScopes: Array<string>;
  availableScopes: Array<string>;
  state: string;
  enabled: boolean;
  disabledSource?: string | null;
  configured: boolean;
  hasCredentials: boolean;
  iconSlug?: string | null;
  iconUrl?: string | null;
  iconDarkUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  credentials: {
    __typename?: "DataProviderCredentials";
    clientId?: string | null;
    credentialsType: string;
    hasCredentials: boolean;
    redactedClientSecret?: string | null;
    redirectUri: string;
  };
  capabilities: {
    __typename?: "OrganizationDataProviderCapabilities";
    canConfigure: boolean;
    canConnect: boolean;
    canDisconnect: boolean;
    canReauthorize: boolean;
    canUpdateCredentials: boolean;
    canAddConnection: boolean;
    addConnectionMethods: Array<string>;
  };
  configFields: Array<{
    __typename?: "DataProviderConfigField";
    key: string;
    label: string;
    required: boolean;
    scope: string;
    description?: string | null;
    example?: string | null;
    pattern?: string | null;
    patternFlags?: string | null;
    order?: number | null;
    secret?: boolean | null;
    default?: string | null;
  }>;
  config: Array<{
    __typename?: "DataProviderConfigEntry";
    name: string;
    value: string;
  }>;
  connection?: {
    __typename?: "DataProviderConnection";
    id: string;
    dataProviderId: string;
    dataProviderSlug: string;
    connectionRole: DataInstallationConnectionRole;
    accountIdentifier?: string | null;
    accountDisplayName?: string | null;
    authMethod: string;
    scopes: Array<string>;
    state: string;
    availability: string;
    apiKeyLast4?: string | null;
    clientId?: string | null;
    clientSecretLast4?: string | null;
    userId?: string | null;
    organizationId?: string | null;
    createdAt: string;
    updatedAt: string;
    capabilities?: {
      __typename?: "DataProviderConnectionCapabilities";
      canReauthorize: boolean;
      canUpdateCredentials: boolean;
    } | null;
    config: Array<{
      __typename?: "DataProviderConfigEntry";
      name: string;
      value: string;
    }>;
  } | null;
  connectedAccounts: Array<{
    __typename?: "DataProviderConnection";
    id: string;
    dataProviderId: string;
    dataProviderSlug: string;
    connectionRole: DataInstallationConnectionRole;
    accountIdentifier?: string | null;
    accountDisplayName?: string | null;
    authMethod: string;
    scopes: Array<string>;
    state: string;
    availability: string;
    apiKeyLast4?: string | null;
    clientId?: string | null;
    clientSecretLast4?: string | null;
    userId?: string | null;
    organizationId?: string | null;
    createdAt: string;
    updatedAt: string;
    capabilities?: {
      __typename?: "DataProviderConnectionCapabilities";
      canReauthorize: boolean;
      canUpdateCredentials: boolean;
    } | null;
    config: Array<{
      __typename?: "DataProviderConfigEntry";
      name: string;
      value: string;
    }>;
  }>;
};

export type SetOrganizationDataProviderConfigurationMutationVariables = Exact<{
  input: SetOrganizationDataProviderConfigurationInput;
}>;

export type SetOrganizationDataProviderConfigurationMutation = {
  __typename?: "Mutation";
  setOrganizationDataProviderConfiguration:
    | { __typename: "DataProviderConfigInvalid"; message: string }
    | {
        __typename: "DataProviderConfiguration";
        dataProviderId: string;
        dataProviderSlug: string;
        organizationId: string;
        enabled: boolean;
        hasCredentials: boolean;
        scopes?: Array<string> | null;
        availableScopes: Array<string>;
        updatedAt: string;
        config: Array<{
          __typename?: "DataProviderConfigEntry";
          name: string;
          value: string;
        }>;
      };
};

export type CreateOrganizationDataProviderConnectionMutationVariables = Exact<{
  input: CreateOrganizationDataProviderConnectionInput;
}>;

export type CreateOrganizationDataProviderConnectionMutation = {
  __typename?: "Mutation";
  createOrganizationDataProviderConnection: {
    __typename?: "DataProviderConnection";
    id: string;
    dataProviderId: string;
    dataProviderSlug: string;
    connectionRole: DataInstallationConnectionRole;
    accountIdentifier?: string | null;
    accountDisplayName?: string | null;
    authMethod: string;
    scopes: Array<string>;
    state: string;
    availability: string;
    apiKeyLast4?: string | null;
    clientId?: string | null;
    clientSecretLast4?: string | null;
    userId?: string | null;
    organizationId?: string | null;
    createdAt: string;
    updatedAt: string;
    capabilities?: {
      __typename?: "DataProviderConnectionCapabilities";
      canReauthorize: boolean;
      canUpdateCredentials: boolean;
    } | null;
    config: Array<{
      __typename?: "DataProviderConfigEntry";
      name: string;
      value: string;
    }>;
  };
};

export type ConnectOrganizationDataProviderWithClientCredentialsMutationVariables =
  Exact<{
    input: ConnectOrganizationDataProviderWithClientCredentialsInput;
  }>;

export type ConnectOrganizationDataProviderWithClientCredentialsMutation = {
  __typename?: "Mutation";
  connectOrganizationDataProviderWithClientCredentials:
    | {
        __typename: "DataProviderAuthMethodUnsupported";
        authMethod: string;
        supportedAuthMethods: Array<string>;
      }
    | { __typename: "DataProviderConfigInvalid"; message: string }
    | {
        __typename: "DataProviderConnected";
        connection: {
          __typename?: "DataProviderConnection";
          id: string;
          dataProviderId: string;
          dataProviderSlug: string;
          connectionRole: DataInstallationConnectionRole;
          accountIdentifier?: string | null;
          accountDisplayName?: string | null;
          authMethod: string;
          scopes: Array<string>;
          state: string;
          availability: string;
          apiKeyLast4?: string | null;
          clientId?: string | null;
          clientSecretLast4?: string | null;
          userId?: string | null;
          organizationId?: string | null;
          createdAt: string;
          updatedAt: string;
          capabilities?: {
            __typename?: "DataProviderConnectionCapabilities";
            canReauthorize: boolean;
            canUpdateCredentials: boolean;
          } | null;
          config: Array<{
            __typename?: "DataProviderConfigEntry";
            name: string;
            value: string;
          }>;
        };
      }
    | {
        __typename: "DataProviderConnectionAuthMethodConflict";
        existingAuthMethod: string;
      };
};

export type DeleteOrganizationDataProviderConnectionMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type DeleteOrganizationDataProviderConnectionMutation = {
  __typename?: "Mutation";
  deleteOrganizationDataProviderConnection: string;
};

export type DataProviderConnectionLabelResultFieldsFragment = {
  __typename?: "UpdateDataProviderConnectionLabelResult";
  connection: {
    __typename?: "DataProviderConnection";
    id: string;
    dataProviderId: string;
    dataProviderSlug: string;
    connectionRole: DataInstallationConnectionRole;
    accountIdentifier?: string | null;
    accountDisplayName?: string | null;
    authMethod: string;
    scopes: Array<string>;
    state: string;
    availability: string;
    apiKeyLast4?: string | null;
    clientId?: string | null;
    clientSecretLast4?: string | null;
    userId?: string | null;
    organizationId?: string | null;
    createdAt: string;
    updatedAt: string;
    capabilities?: {
      __typename?: "DataProviderConnectionCapabilities";
      canReauthorize: boolean;
      canUpdateCredentials: boolean;
    } | null;
    config: Array<{
      __typename?: "DataProviderConfigEntry";
      name: string;
      value: string;
    }>;
  };
  warnings: Array<{
    __typename?: "DataProviderConnectionLabelWarning";
    code: string;
    message: string;
  }>;
};

export type UpdateDataProviderConnectionLabelMutationVariables = Exact<{
  input: UpdateDataProviderConnectionLabelInput;
}>;

export type UpdateDataProviderConnectionLabelMutation = {
  __typename?: "Mutation";
  updateDataProviderConnectionLabel: {
    __typename?: "UpdateDataProviderConnectionLabelResult";
    connection: {
      __typename?: "DataProviderConnection";
      id: string;
      dataProviderId: string;
      dataProviderSlug: string;
      connectionRole: DataInstallationConnectionRole;
      accountIdentifier?: string | null;
      accountDisplayName?: string | null;
      authMethod: string;
      scopes: Array<string>;
      state: string;
      availability: string;
      apiKeyLast4?: string | null;
      clientId?: string | null;
      clientSecretLast4?: string | null;
      userId?: string | null;
      organizationId?: string | null;
      createdAt: string;
      updatedAt: string;
      capabilities?: {
        __typename?: "DataProviderConnectionCapabilities";
        canReauthorize: boolean;
        canUpdateCredentials: boolean;
      } | null;
      config: Array<{
        __typename?: "DataProviderConfigEntry";
        name: string;
        value: string;
      }>;
    };
    warnings: Array<{
      __typename?: "DataProviderConnectionLabelWarning";
      code: string;
      message: string;
    }>;
  };
};

export type UpdateOrganizationDataProviderConnectionLabelMutationVariables =
  Exact<{
    input: UpdateDataProviderConnectionLabelInput;
  }>;

export type UpdateOrganizationDataProviderConnectionLabelMutation = {
  __typename?: "Mutation";
  updateOrganizationDataProviderConnectionLabel: {
    __typename?: "UpdateDataProviderConnectionLabelResult";
    connection: {
      __typename?: "DataProviderConnection";
      id: string;
      dataProviderId: string;
      dataProviderSlug: string;
      connectionRole: DataInstallationConnectionRole;
      accountIdentifier?: string | null;
      accountDisplayName?: string | null;
      authMethod: string;
      scopes: Array<string>;
      state: string;
      availability: string;
      apiKeyLast4?: string | null;
      clientId?: string | null;
      clientSecretLast4?: string | null;
      userId?: string | null;
      organizationId?: string | null;
      createdAt: string;
      updatedAt: string;
      capabilities?: {
        __typename?: "DataProviderConnectionCapabilities";
        canReauthorize: boolean;
        canUpdateCredentials: boolean;
      } | null;
      config: Array<{
        __typename?: "DataProviderConfigEntry";
        name: string;
        value: string;
      }>;
    };
    warnings: Array<{
      __typename?: "DataProviderConnectionLabelWarning";
      code: string;
      message: string;
    }>;
  };
};

export type RegisterPasskeyMutationVariables = Exact<{
  input: RegisterPasskeyInput;
}>;

export type RegisterPasskeyMutation = {
  __typename?: "Mutation";
  registerPasskey:
    | { __typename: "ElevatedAccessTokenExpired"; message: string }
    | { __typename: "ElevatedAccessTokenInvalid"; message: string }
    | {
        __typename: "PasskeyRegistrationOptions";
        challengeId: string;
        options: any;
      };
};

export type VerifyPasskeyMutationVariables = Exact<{
  input: VerifyPasskeyInput;
}>;

export type VerifyPasskeyMutation = {
  __typename?: "Mutation";
  verifyPasskey:
    | { __typename: "ElevatedAccessTokenExpired"; message: string }
    | { __typename: "ElevatedAccessTokenInvalid"; message: string }
    | { __typename: "PasskeyChallengeNotFound"; _placeholder: boolean }
    | { __typename: "PasskeyVerificationFailed"; _placeholder: boolean }
    | { __typename: "PasskeyVerified"; success: boolean };
};

export type DeletePasskeyMutationVariables = Exact<{
  input: DeletePasskeyInput;
}>;

export type DeletePasskeyMutation = {
  __typename?: "Mutation";
  deletePasskey:
    | { __typename: "ElevatedAccessTokenExpired"; message: string }
    | { __typename: "ElevatedAccessTokenInvalid"; message: string }
    | { __typename: "PasskeyDeleted"; success: boolean }
    | { __typename: "PasskeyNotFound"; _placeholder: boolean };
};

export type CreateAdminPortalLinkMutationVariables = Exact<{
  intent: AdminPortalLinkIntent;
}>;

export type CreateAdminPortalLinkMutation = {
  __typename?: "Mutation";
  createAdminPortalLink: {
    __typename?: "AdminPortalLink";
    link: string;
    intent: AdminPortalLinkIntent;
    expiresAt: string;
  };
};

export type AuditLogStreamQueryVariables = Exact<{ [key: string]: never }>;

export type AuditLogStreamQuery = {
  __typename?: "Query";
  auditLogStream?: {
    __typename?: "AuditLogStream";
    id: string;
    auditLogTrailId: string;
    type: AuditLogStreamType;
    state: AuditLogStreamState;
    errorMessage?: string | null;
    lastSyncedEventId?: string | null;
  } | null;
};

export type BrandingQueryVariables = Exact<{ [key: string]: never }>;

export type BrandingQuery = {
  __typename?: "Query";
  branding: {
    __typename?: "Branding";
    displayName: string;
    logoLightPath?: string | null;
    logoDarkPath?: string | null;
    logoLightIconPath?: string | null;
    logoDarkIconPath?: string | null;
  };
};

export type AuthKitSettingsQueryVariables = Exact<{ [key: string]: never }>;

export type AuthKitSettingsQuery = {
  __typename?: "Query";
  authkitSettings: { __typename?: "AuthKitSettings"; origin: string };
};

export type ListPermissionsQueryVariables = Exact<{
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  search?: InputMaybe<Scalars["String"]["input"]>;
}>;

export type ListPermissionsQuery = {
  __typename?: "Query";
  permissions: {
    __typename?: "PermissionList";
    data: Array<{
      __typename?: "Permission";
      id: string;
      slug: string;
      name: string;
      description?: string | null;
      system: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
    listMetadata: {
      __typename?: "ListMetadata";
      after?: string | null;
      before?: string | null;
    };
  };
};

export type ListApiKeyPermissionsQueryVariables = Exact<{
  apiKeyOwnerType: ApiKeyOwnerType;
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  search?: InputMaybe<Scalars["String"]["input"]>;
}>;

export type ListApiKeyPermissionsQuery = {
  __typename?: "Query";
  permissions: {
    __typename?: "PermissionList";
    data: Array<{
      __typename?: "Permission";
      id: string;
      slug: string;
      name: string;
      description?: string | null;
    }>;
    listMetadata: {
      __typename?: "ListMetadata";
      after?: string | null;
      before?: string | null;
    };
  };
};

export type GetOrganizationDomainQueryVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type GetOrganizationDomainQuery = {
  __typename?: "Query";
  organizationDomain: {
    __typename?: "OrganizationDomain";
    id: string;
    organizationId: string;
    domain: string;
    subdomain?: string | null;
    state: OrganizationDomainState;
    verificationPrefix?: string | null;
    verificationToken?: string | null;
    nameServer: DomainVerificationNameServer;
    createdAt: string;
  };
};

export type SharedDataProviderFieldsFragment = {
  __typename?: "SharedDataProvider";
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  integrationType: string;
  iconSlug?: string | null;
  iconUrl?: string | null;
  iconDarkUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  connectedAccounts: Array<{
    __typename?: "SharedDataProviderConnection";
    id: string;
    dataProviderId: string;
    dataProviderSlug: string;
    authMethod: string;
    connectionRole: DataInstallationConnectionRole;
    state: string;
    availability: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type ListSharedDataProvidersQueryVariables = Exact<{
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  supportsMultipleConnections?: InputMaybe<Scalars["Boolean"]["input"]>;
}>;

export type ListSharedDataProvidersQuery = {
  __typename?: "Query";
  sharedDataProviders: {
    __typename?: "SharedDataProviderList";
    data: Array<{
      __typename?: "SharedDataProvider";
      id: string;
      slug: string;
      name: string;
      description?: string | null;
      integrationType: string;
      iconSlug?: string | null;
      iconUrl?: string | null;
      iconDarkUrl?: string | null;
      createdAt: string;
      updatedAt: string;
      connectedAccounts: Array<{
        __typename?: "SharedDataProviderConnection";
        id: string;
        dataProviderId: string;
        dataProviderSlug: string;
        authMethod: string;
        connectionRole: DataInstallationConnectionRole;
        state: string;
        availability: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>;
    listMetadata: {
      __typename?: "ListMetadata";
      after?: string | null;
      before?: string | null;
    };
  };
};

export type ConfigurableDataProviderFieldsFragment = {
  __typename?: "ConfigurableDataProvider";
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  integrationType: string;
  authMethods: Array<string>;
  credentialsType: string;
  scopes?: Array<string> | null;
  defaultScopes: Array<string>;
  availableScopes: Array<string>;
  state: string;
  enabled: boolean;
  iconSlug?: string | null;
  iconUrl?: string | null;
  iconDarkUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  credentials: {
    __typename?: "DataProviderCredentials";
    clientId?: string | null;
    credentialsType: string;
    hasCredentials: boolean;
    redactedClientSecret?: string | null;
    redirectUri: string;
  };
  configFields: Array<{
    __typename?: "DataProviderConfigField";
    key: string;
    label: string;
    required: boolean;
    scope: string;
    description?: string | null;
    example?: string | null;
    pattern?: string | null;
    patternFlags?: string | null;
    order?: number | null;
    secret?: boolean | null;
    default?: string | null;
  }>;
  config: Array<{
    __typename?: "DataProviderConfigEntry";
    name: string;
    value: string;
  }>;
};

export type ListConfigurableDataProvidersQueryVariables = Exact<{
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
}>;

export type ListConfigurableDataProvidersQuery = {
  __typename?: "Query";
  configurableDataProviders: {
    __typename?: "ConfigurableDataProviderList";
    data: Array<{
      __typename?: "ConfigurableDataProvider";
      id: string;
      slug: string;
      name: string;
      description?: string | null;
      integrationType: string;
      authMethods: Array<string>;
      credentialsType: string;
      scopes?: Array<string> | null;
      defaultScopes: Array<string>;
      availableScopes: Array<string>;
      state: string;
      enabled: boolean;
      iconSlug?: string | null;
      iconUrl?: string | null;
      iconDarkUrl?: string | null;
      createdAt: string;
      updatedAt: string;
      credentials: {
        __typename?: "DataProviderCredentials";
        clientId?: string | null;
        credentialsType: string;
        hasCredentials: boolean;
        redactedClientSecret?: string | null;
        redirectUri: string;
      };
      configFields: Array<{
        __typename?: "DataProviderConfigField";
        key: string;
        label: string;
        required: boolean;
        scope: string;
        description?: string | null;
        example?: string | null;
        pattern?: string | null;
        patternFlags?: string | null;
        order?: number | null;
        secret?: boolean | null;
        default?: string | null;
      }>;
      config: Array<{
        __typename?: "DataProviderConfigEntry";
        name: string;
        value: string;
      }>;
    }>;
    listMetadata: {
      __typename?: "ListMetadata";
      after?: string | null;
      before?: string | null;
    };
  };
};

export type OrganizationApiKeyFieldsFragment = {
  __typename?: "OrganizationApiKey";
  id: string;
  name: string;
  obfuscatedValue: string;
  permissions: Array<string>;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserApiKeyFieldsFragment = {
  __typename?: "UserApiKey";
  id: string;
  name: string;
  obfuscatedValue: string;
  permissions: Array<string>;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  owner: {
    __typename?: "UserApiKeyOwner";
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    displayName: string;
  };
};

export type ListOrganizationApiKeysQueryVariables = Exact<{
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  search?: InputMaybe<Scalars["String"]["input"]>;
}>;

export type ListOrganizationApiKeysQuery = {
  __typename?: "Query";
  organizationApiKeys: {
    __typename?: "OrganizationApiKeyList";
    data: Array<{
      __typename?: "OrganizationApiKey";
      id: string;
      name: string;
      obfuscatedValue: string;
      permissions: Array<string>;
      lastUsedAt?: string | null;
      expiresAt?: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    listMetadata: {
      __typename?: "ListMetadata";
      after?: string | null;
      before?: string | null;
    };
  };
};

export type ListUserApiKeysQueryVariables = Exact<{
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<PaginationOrder>;
  search?: InputMaybe<Scalars["String"]["input"]>;
}>;

export type ListUserApiKeysQuery = {
  __typename?: "Query";
  userApiKeys: {
    __typename?: "UserApiKeyList";
    data: Array<{
      __typename?: "UserApiKey";
      id: string;
      name: string;
      obfuscatedValue: string;
      permissions: Array<string>;
      lastUsedAt?: string | null;
      expiresAt?: string | null;
      createdAt: string;
      updatedAt: string;
      owner: {
        __typename?: "UserApiKeyOwner";
        id: string;
        email: string;
        firstName?: string | null;
        lastName?: string | null;
        displayName: string;
      };
    }>;
    listMetadata: {
      __typename?: "ListMetadata";
      after?: string | null;
      before?: string | null;
    };
  };
};

export type CreateOrganizationApiKeyMutationVariables = Exact<{
  input: CreateApiKeyInput;
}>;

export type CreateOrganizationApiKeyMutation = {
  __typename?: "Mutation";
  createOrganizationApiKey:
    | {
        __typename: "ApiKeyPermissionsNotHeld";
        message: string;
        unheldPermissions: Array<string>;
      }
    | {
        __typename: "ApiKeyPermissionsUnsupportedForToken";
        message: string;
        requestedPermissions: Array<string>;
      }
    | { __typename: "InvalidApiKeyExpiration"; message: string }
    | { __typename: "InvalidApiKeyName"; message: string }
    | {
        __typename: "InvalidApiKeyPermissions";
        message: string;
        invalidPermissions: Array<string>;
      }
    | {
        __typename: "OrganizationApiKeyCreated";
        value: string;
        apiKey: {
          __typename?: "OrganizationApiKey";
          id: string;
          name: string;
          obfuscatedValue: string;
          permissions: Array<string>;
          lastUsedAt?: string | null;
          expiresAt?: string | null;
          createdAt: string;
          updatedAt: string;
        };
      };
};

export type CreateUserApiKeyMutationVariables = Exact<{
  input: CreateApiKeyInput;
}>;

export type CreateUserApiKeyMutation = {
  __typename?: "Mutation";
  createUserApiKey:
    | {
        __typename: "ApiKeyPermissionsNotHeld";
        message: string;
        unheldPermissions: Array<string>;
      }
    | {
        __typename: "ApiKeyPermissionsUnsupportedForToken";
        message: string;
        requestedPermissions: Array<string>;
      }
    | { __typename: "InvalidApiKeyExpiration"; message: string }
    | { __typename: "InvalidApiKeyName"; message: string }
    | {
        __typename: "InvalidApiKeyPermissions";
        message: string;
        invalidPermissions: Array<string>;
      }
    | {
        __typename: "UserApiKeyCreated";
        value: string;
        apiKey: {
          __typename?: "UserApiKey";
          id: string;
          name: string;
          obfuscatedValue: string;
          permissions: Array<string>;
          lastUsedAt?: string | null;
          expiresAt?: string | null;
          createdAt: string;
          updatedAt: string;
          owner: {
            __typename?: "UserApiKeyOwner";
            id: string;
            email: string;
            firstName?: string | null;
            lastName?: string | null;
            displayName: string;
          };
        };
      };
};

export type ExpireOrganizationApiKeyMutationVariables = Exact<{
  input: ExpireApiKeyInput;
}>;

export type ExpireOrganizationApiKeyMutation = {
  __typename?: "Mutation";
  expireOrganizationApiKey:
    | { __typename: "ApiKeyAlreadyExpired"; apiKeyId: string }
    | {
        __typename: "OrganizationApiKeyExpired";
        apiKey: {
          __typename?: "OrganizationApiKey";
          id: string;
          name: string;
          obfuscatedValue: string;
          permissions: Array<string>;
          lastUsedAt?: string | null;
          expiresAt?: string | null;
          createdAt: string;
          updatedAt: string;
        };
      };
};

export type ExpireUserApiKeyMutationVariables = Exact<{
  input: ExpireApiKeyInput;
}>;

export type ExpireUserApiKeyMutation = {
  __typename?: "Mutation";
  expireUserApiKey:
    | { __typename: "ApiKeyAlreadyExpired"; apiKeyId: string }
    | {
        __typename: "UserApiKeyExpired";
        apiKey: {
          __typename?: "UserApiKey";
          id: string;
          name: string;
          obfuscatedValue: string;
          permissions: Array<string>;
          lastUsedAt?: string | null;
          expiresAt?: string | null;
          createdAt: string;
          updatedAt: string;
          owner: {
            __typename?: "UserApiKeyOwner";
            id: string;
            email: string;
            firstName?: string | null;
            lastName?: string | null;
            displayName: string;
          };
        };
      };
};

export type DeleteOrganizationApiKeyMutationVariables = Exact<{
  apiKeyId: Scalars["ID"]["input"];
}>;

export type DeleteOrganizationApiKeyMutation = {
  __typename?: "Mutation";
  deleteOrganizationApiKey: {
    __typename?: "OrganizationApiKey";
    id: string;
    name: string;
    obfuscatedValue: string;
    permissions: Array<string>;
    lastUsedAt?: string | null;
    expiresAt?: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

export type DeleteUserApiKeyMutationVariables = Exact<{
  apiKeyId: Scalars["ID"]["input"];
}>;

export type DeleteUserApiKeyMutation = {
  __typename?: "Mutation";
  deleteUserApiKey: {
    __typename?: "UserApiKey";
    id: string;
    name: string;
    obfuscatedValue: string;
    permissions: Array<string>;
    lastUsedAt?: string | null;
    expiresAt?: string | null;
    createdAt: string;
    updatedAt: string;
    owner: {
      __typename?: "UserApiKeyOwner";
      id: string;
      email: string;
      firstName?: string | null;
      lastName?: string | null;
      displayName: string;
    };
  };
};

export const OrganizationDomainFieldsFragmentDoc = `
    fragment OrganizationDomainFields on OrganizationDomain {
  id
  organizationId
  domain
  subdomain
  state
  verificationPrefix
  verificationToken
  nameServer
  createdAt
}
    `;
export const UserFieldsFragmentDoc = `
    fragment UserFields on User {
  id
  email
  emailVerified
  firstName
  lastName
  profilePictureUrl
  mfaEnabled
  mfaLastUsedAt
  passwordSet
  passwordLastUsedAt
  createdAt
  updatedAt
}
    `;
export const ConnectedAccountFieldsFragmentDoc = `
    fragment ConnectedAccountFields on ConnectedAccount {
  id
  provider
  email
  firstName
  lastName
  profilePictureUrl
  lastLoginAt
}
    `;
export const PasswordViolationFieldsFragmentDoc = `
    fragment PasswordViolationFields on PasswordViolation {
  code
  message
  characterType
  minimumLength
  maximumLength
  allowedSymbols
  breachOccurrences
  strengthWarning
  strengthSuggestions
}
    `;
export const SessionFieldsFragmentDoc = `
    fragment SessionFields on Session {
  id
  isCurrent
  ipAddress
  userAgent
  organizationId
  lastActivityAt
  createdAt
  updatedAt
  state {
    tag
    expiresAt
  }
  currentLocation {
    cityName
    countryISOCode
  }
}
    `;
export const OrganizationMemberFieldsFragmentDoc = `
    fragment OrganizationMemberFields on OrganizationMember {
  id
  email
  emailVerified
  firstName
  lastName
  profilePictureUrl
  status
  lastActivityAt
  createdAt
  actions
  isCurrentUser
  isDirectoryManaged
  roles {
    slug
    name
  }
}
    `;
export const OrganizationInvitationFieldsFragmentDoc = `
    fragment OrganizationInvitationFields on OrganizationInvitation {
  id
  email
  status
  roleSlug
  expiresAt
  createdAt
}
    `;
export const RoleFieldsFragmentDoc = `
    fragment RoleFields on Role {
  id
  slug
  name
  description
  isDefault
  createdAt
  updatedAt
}
    `;
export const DirectoryFieldsFragmentDoc = `
    fragment DirectoryFields on Directory {
  id
  name
  organizationId
  externalKey
  state
  type
  lastSyncRunAt
  metadata {
    groups
    users {
      active
    }
  }
  createdAt
  updatedAt
}
    `;
export const ConnectionFieldsFragmentDoc = `
    fragment ConnectionFields on Connection {
  id
  name
  organizationId
  type
  providerTag
  state
  setupComplete
  lastSession {
    id
    createdAt
    state
  }
  latestExpiringCertificate {
    id
    notAfter
  }
  latestExpiredCertificate {
    id
    notAfter
  }
  createdAt
  updatedAt
}
    `;
export const DataProviderConfigFieldFieldsFragmentDoc = `
    fragment DataProviderConfigFieldFields on DataProviderConfigField {
  key
  label
  required
  scope
  description
  example
  pattern
  patternFlags
  order
  secret
  default
}
    `;
export const DataProviderFieldsFragmentDoc = `
    fragment DataProviderFields on DataProvider {
  id
  slug
  name
  description
  integrationType
  authMethods
  credentialsType
  scopes
  state
  enabled
  iconSlug
  iconUrl
  iconDarkUrl
  capabilities {
    canAddConnection
    addConnectionMethods
  }
  configFields {
    ...DataProviderConfigFieldFields
  }
  config {
    name
    value
  }
  createdAt
  updatedAt
}
    ${DataProviderConfigFieldFieldsFragmentDoc}`;
export const DataProviderAuthorizationResultFieldsFragmentDoc = `
    fragment DataProviderAuthorizationResultFields on CreateDataProviderAuthorizationResult {
  __typename
  ... on DataProviderAuthorization {
    url
    state
    redirectToken
    handoffToken
  }
  ... on DataProviderAuthorizationUnavailable {
    message
  }
  ... on DataProviderConfigInvalid {
    message
  }
}
    `;
export const DataProviderConfigurationFieldsFragmentDoc = `
    fragment DataProviderConfigurationFields on DataProviderConfiguration {
  dataProviderId
  dataProviderSlug
  organizationId
  enabled
  hasCredentials
  scopes
  availableScopes
  config {
    name
    value
  }
  updatedAt
}
    `;
export const DataProviderConnectionFieldsFragmentDoc = `
    fragment DataProviderConnectionFields on DataProviderConnection {
  id
  dataProviderId
  dataProviderSlug
  connectionRole
  accountIdentifier
  accountDisplayName
  authMethod
  scopes
  state
  availability
  capabilities {
    canReauthorize
    canUpdateCredentials
  }
  apiKeyLast4
  clientId
  clientSecretLast4
  config {
    name
    value
  }
  userId
  organizationId
  createdAt
  updatedAt
}
    `;
export const OrganizationDataProviderFieldsFragmentDoc = `
    fragment OrganizationDataProviderFields on OrganizationDataProvider {
  id
  slug
  name
  description
  integrationType
  authMethods
  credentialsType
  scopes
  defaultScopes
  availableScopes
  state
  enabled
  disabledSource
  configured
  hasCredentials
  iconSlug
  iconUrl
  iconDarkUrl
  credentials {
    clientId
    credentialsType
    hasCredentials
    redactedClientSecret
    redirectUri
  }
  capabilities {
    canConfigure
    canConnect
    canDisconnect
    canReauthorize
    canUpdateCredentials
    canAddConnection
    addConnectionMethods
  }
  configFields {
    ...DataProviderConfigFieldFields
  }
  config {
    name
    value
  }
  connection {
    ...DataProviderConnectionFields
  }
  connectedAccounts {
    ...DataProviderConnectionFields
  }
  createdAt
  updatedAt
}
    ${DataProviderConfigFieldFieldsFragmentDoc}
${DataProviderConnectionFieldsFragmentDoc}`;
export const DataProviderConnectionLabelResultFieldsFragmentDoc = `
    fragment DataProviderConnectionLabelResultFields on UpdateDataProviderConnectionLabelResult {
  connection {
    ...DataProviderConnectionFields
  }
  warnings {
    code
    message
  }
}
    ${DataProviderConnectionFieldsFragmentDoc}`;
export const SharedDataProviderFieldsFragmentDoc = `
    fragment SharedDataProviderFields on SharedDataProvider {
  id
  slug
  name
  description
  integrationType
  iconSlug
  iconUrl
  iconDarkUrl
  connectedAccounts {
    id
    dataProviderId
    dataProviderSlug
    authMethod
    connectionRole
    state
    availability
    createdAt
    updatedAt
  }
  createdAt
  updatedAt
}
    `;
export const ConfigurableDataProviderFieldsFragmentDoc = `
    fragment ConfigurableDataProviderFields on ConfigurableDataProvider {
  id
  slug
  name
  description
  integrationType
  authMethods
  credentialsType
  scopes
  defaultScopes
  availableScopes
  state
  enabled
  iconSlug
  iconUrl
  iconDarkUrl
  credentials {
    clientId
    credentialsType
    hasCredentials
    redactedClientSecret
    redirectUri
  }
  configFields {
    ...DataProviderConfigFieldFields
  }
  config {
    name
    value
  }
  createdAt
  updatedAt
}
    ${DataProviderConfigFieldFieldsFragmentDoc}`;
export const OrganizationApiKeyFieldsFragmentDoc = `
    fragment OrganizationApiKeyFields on OrganizationApiKey {
  id
  name
  obfuscatedValue
  permissions
  lastUsedAt
  expiresAt
  createdAt
  updatedAt
}
    `;
export const UserApiKeyFieldsFragmentDoc = `
    fragment UserApiKeyFields on UserApiKey {
  id
  name
  obfuscatedValue
  permissions
  lastUsedAt
  expiresAt
  createdAt
  updatedAt
  owner {
    id
    email
    firstName
    lastName
    displayName
  }
}
    `;
export const ClientApiStatusDocument = `
    query ClientApiStatus {
  clientApiStatus
}
    `;
export const ListOrganizationDomainsDocument = `
    query ListOrganizationDomains($after: String, $before: String, $limit: Int, $order: PaginationOrder) {
  organizationDomains(
    after: $after
    before: $before
    limit: $limit
    order: $order
  ) {
    data {
      ...OrganizationDomainFields
    }
    listMetadata {
      after
      before
    }
  }
}
    ${OrganizationDomainFieldsFragmentDoc}`;
export const CreateOrganizationDomainDocument = `
    mutation CreateOrganizationDomain($domain: String!) {
  createOrganizationDomain(domain: $domain) {
    ...OrganizationDomainFields
  }
}
    ${OrganizationDomainFieldsFragmentDoc}`;
export const DeleteOrganizationDomainDocument = `
    mutation DeleteOrganizationDomain($id: ID!) {
  deleteOrganizationDomain(id: $id) {
    ...OrganizationDomainFields
  }
}
    ${OrganizationDomainFieldsFragmentDoc}`;
export const ReverifyOrganizationDomainDocument = `
    mutation ReverifyOrganizationDomain($id: ID!) {
  reverifyOrganizationDomain(id: $id) {
    ...OrganizationDomainFields
  }
}
    ${OrganizationDomainFieldsFragmentDoc}`;
export const MeDocument = `
    query Me {
  me {
    ...UserFields
    connectedAccounts {
      ...ConnectedAccountFields
    }
  }
}
    ${UserFieldsFragmentDoc}
${ConnectedAccountFieldsFragmentDoc}`;
export const AuthenticationSettingsDocument = `
    query AuthenticationSettings {
  authenticationSettings {
    mfaEnabled
    mfaRequired
    passkeyAuthEnabled
    passwordAuthEnabled
    passwordPolicy {
      minimumLength
      minimumStrength
      rejectsBreachedPasswords
      requiresLowercase
      requiresNumber
      requiresSymbol
      requiresUppercase
    }
  }
}
    `;
export const PasskeysDocument = `
    query Passkeys {
  passkeys {
    id
    createdAt
    updatedAt
    lastVerifiedAt
  }
}
    `;
export const UpdateProfileDocument = `
    mutation UpdateProfile($input: UpdateProfileInput!) {
  updateProfile(input: $input) {
    __typename
    ... on ProfileUpdated {
      user {
        ...UserFields
      }
    }
  }
}
    ${UserFieldsFragmentDoc}`;
export const SendVerificationCodeDocument = `
    mutation SendVerificationCode {
  sendVerificationCode {
    __typename
    ... on VerificationCodeSent {
      authenticationChallengeId
      expiresAt
    }
  }
}
    `;
export const VerifyCurrentEmailDocument = `
    mutation VerifyCurrentEmail($input: VerifyCurrentEmailInput!) {
  verifyCurrentEmail(input: $input) {
    __typename
    ... on CurrentEmailVerified {
      elevatedAccessToken
      expiresAt
    }
  }
}
    `;
export const SendEmailChangeDocument = `
    mutation SendEmailChange($input: SendEmailChangeInput!) {
  sendEmailChange(input: $input) {
    __typename
    ... on EmailChangeSent {
      expiresAt
    }
  }
}
    `;
export const ConfirmEmailChangeDocument = `
    mutation ConfirmEmailChange($input: ConfirmEmailChangeInput!) {
  confirmEmailChange(input: $input) {
    __typename
    ... on EmailChangeConfirmed {
      elevatedAccessToken
      expiresAt
      user {
        ...UserFields
      }
    }
  }
}
    ${UserFieldsFragmentDoc}`;
export const CreatePasswordDocument = `
    mutation CreatePassword($input: CreatePasswordInput!) {
  createPassword(input: $input) {
    __typename
    ... on PasswordCreated {
      success
    }
    ... on PasswordPolicyViolation {
      code
      message
      violations {
        ...PasswordViolationFields
      }
    }
  }
}
    ${PasswordViolationFieldsFragmentDoc}`;
export const UpdatePasswordDocument = `
    mutation UpdatePassword($input: UpdatePasswordInput!) {
  updatePassword(input: $input) {
    __typename
    ... on PasswordUpdated {
      success
    }
    ... on PasswordPolicyViolation {
      code
      message
      violations {
        ...PasswordViolationFields
      }
    }
  }
}
    ${PasswordViolationFieldsFragmentDoc}`;
export const EnrollTotpDocument = `
    mutation EnrollTotp($input: EnrollTotpInput!) {
  enrollTotp(input: $input) {
    __typename
    ... on TotpFactor {
      authenticationChallengeId
      authenticationFactorId
      secret
      uri
      qrCode
    }
  }
}
    `;
export const VerifyTotpDocument = `
    mutation VerifyTotp($input: VerifyTotpInput!) {
  verifyTotp(input: $input) {
    __typename
    ... on TotpVerified {
      success
    }
  }
}
    `;
export const RemoveMfaFactorDocument = `
    mutation RemoveMfaFactor($input: RemoveMfaFactorInput!) {
  removeMfaFactor(input: $input) {
    __typename
    ... on MfaFactorRemoved {
      success
    }
  }
}
    `;
export const SessionsDocument = `
    query Sessions {
  sessions {
    ...SessionFields
  }
}
    ${SessionFieldsFragmentDoc}`;
export const RevokeSessionDocument = `
    mutation RevokeSession($input: RevokeSessionInput!) {
  revokeSession(input: $input) {
    __typename
    ... on SessionRevoked {
      session {
        ...SessionFields
      }
    }
  }
}
    ${SessionFieldsFragmentDoc}`;
export const RevokeAllSessionsDocument = `
    mutation RevokeAllSessions($input: RevokeAllSessionsInput) {
  revokeAllSessions(input: $input) {
    __typename
    ... on AllSessionsRevoked {
      success
    }
  }
}
    `;
export const ListOrganizationMembershipsDocument = `
    query ListOrganizationMemberships($after: String, $before: String, $limit: Int, $order: PaginationOrder, $roleSlug: String, $search: String) {
  organizationMemberships(
    after: $after
    before: $before
    limit: $limit
    order: $order
    roleSlug: $roleSlug
    search: $search
  ) {
    data {
      ...OrganizationMemberFields
    }
    listMetadata {
      after
      before
    }
  }
}
    ${OrganizationMemberFieldsFragmentDoc}`;
export const ListRolesDocument = `
    query ListRoles {
  roles {
    multipleRolesEnabled
    roles {
      ...RoleFields
    }
  }
}
    ${RoleFieldsFragmentDoc}`;
export const InviteUserDocument = `
    mutation InviteUser($input: InviteUserInput!) {
  inviteUser(input: $input) {
    __typename
    ... on UserInvited {
      invitation {
        ...OrganizationInvitationFields
      }
    }
  }
}
    ${OrganizationInvitationFieldsFragmentDoc}`;
export const UpdateMemberRoleDocument = `
    mutation UpdateMemberRole($input: UpdateMemberRoleInput!) {
  updateMemberRole(input: $input) {
    __typename
    ... on MemberRoleUpdated {
      member {
        ...OrganizationMemberFields
      }
    }
    ... on RoleNotFound {
      roleSlugs
    }
  }
}
    ${OrganizationMemberFieldsFragmentDoc}`;
export const RemoveMemberDocument = `
    mutation RemoveMember($input: RemoveMemberInput!) {
  removeMember(input: $input) {
    __typename
    ... on MemberRemoved {
      userId
    }
  }
}
    `;
export const ResendInvitationDocument = `
    mutation ResendInvitation($input: ResendInvitationInput!) {
  resendInvitation(input: $input) {
    __typename
    ... on InvitationResent {
      invitation {
        ...OrganizationInvitationFields
      }
    }
  }
}
    ${OrganizationInvitationFieldsFragmentDoc}`;
export const RevokeInvitationDocument = `
    mutation RevokeInvitation($input: RevokeInvitationInput!) {
  revokeInvitation(input: $input) {
    __typename
    ... on InvitationRevoked {
      invitation {
        ...OrganizationInvitationFields
      }
    }
  }
}
    ${OrganizationInvitationFieldsFragmentDoc}`;
export const ListUserOrganizationsDocument = `
    query ListUserOrganizations {
  organizations {
    id
    name
    isCurrent
  }
}
    `;
export const ListDirectoryConnectionsDocument = `
    query ListDirectoryConnections($after: String, $before: String, $limit: Int, $order: PaginationOrder, $search: String) {
  directoryConnections(
    after: $after
    before: $before
    limit: $limit
    order: $order
    search: $search
  ) {
    data {
      ...DirectoryFields
    }
    listMetadata {
      after
      before
    }
  }
}
    ${DirectoryFieldsFragmentDoc}`;
export const GetDirectoryConnectionDocument = `
    query GetDirectoryConnection($id: ID!) {
  directoryConnection(id: $id) {
    ...DirectoryFields
  }
}
    ${DirectoryFieldsFragmentDoc}`;
export const ListSsoConnectionsDocument = `
    query ListSsoConnections {
  ssoConnections {
    ...ConnectionFields
  }
}
    ${ConnectionFieldsFragmentDoc}`;
export const GetSsoConnectionDocument = `
    query GetSsoConnection($id: ID!) {
  ssoConnection(id: $id) {
    ...ConnectionFields
  }
}
    ${ConnectionFieldsFragmentDoc}`;
export const ListDataProvidersDocument = `
    query ListDataProviders($after: String, $before: String, $limit: Int, $order: PaginationOrder) {
  dataProviders(after: $after, before: $before, limit: $limit, order: $order) {
    data {
      ...DataProviderFields
    }
    listMetadata {
      after
      before
    }
  }
}
    ${DataProviderFieldsFragmentDoc}`;
export const ListDataProviderConnectionsDocument = `
    query ListDataProviderConnections($after: String, $before: String, $limit: Int, $order: PaginationOrder) {
  dataProviderConnections(
    after: $after
    before: $before
    limit: $limit
    order: $order
  ) {
    data {
      ...DataProviderConnectionFields
    }
    listMetadata {
      after
      before
    }
  }
}
    ${DataProviderConnectionFieldsFragmentDoc}`;
export const CreateDataProviderConnectionDocument = `
    mutation CreateDataProviderConnection($input: CreateDataProviderConnectionInput!) {
  createDataProviderConnection(input: $input) {
    ...DataProviderConnectionFields
  }
}
    ${DataProviderConnectionFieldsFragmentDoc}`;
export const DeleteDataProviderConnectionDocument = `
    mutation DeleteDataProviderConnection($id: ID!) {
  deleteDataProviderConnection(id: $id)
}
    `;
export const SetDataProviderEnabledDocument = `
    mutation SetDataProviderEnabled($input: SetDataProviderEnabledInput!) {
  setDataProviderEnabled(input: $input) {
    ...DataProviderFields
  }
}
    ${DataProviderFieldsFragmentDoc}`;
export const CreateDataProviderAuthorizationDocument = `
    mutation CreateDataProviderAuthorization($input: CreateDataProviderAuthorizationInput!) {
  createDataProviderAuthorization(input: $input) {
    ...DataProviderAuthorizationResultFields
  }
}
    ${DataProviderAuthorizationResultFieldsFragmentDoc}`;
export const CreateOrganizationDataProviderAuthorizationDocument = `
    mutation CreateOrganizationDataProviderAuthorization($input: CreateOrganizationDataProviderAuthorizationInput!) {
  createOrganizationDataProviderAuthorization(input: $input) {
    ...DataProviderAuthorizationResultFields
  }
}
    ${DataProviderAuthorizationResultFieldsFragmentDoc}`;
export const DataProviderAuthorizationStatusDocument = `
    query DataProviderAuthorizationStatus($dataProviderId: ID!, $state: String!) {
  dataProviderAuthorizationStatus(dataProviderId: $dataProviderId, state: $state) {
    state
    connecting
  }
}
    `;
export const ConnectDataProviderWithClientCredentialsDocument = `
    mutation ConnectDataProviderWithClientCredentials($input: ConnectDataProviderWithClientCredentialsInput!) {
  connectDataProviderWithClientCredentials(input: $input) {
    __typename
    ... on DataProviderConnected {
      connection {
        ...DataProviderConnectionFields
      }
    }
    ... on DataProviderAuthMethodUnsupported {
      authMethod
      supportedAuthMethods
    }
    ... on DataProviderConnectionAuthMethodConflict {
      existingAuthMethod
    }
    ... on DataProviderConfigInvalid {
      message
    }
  }
}
    ${DataProviderConnectionFieldsFragmentDoc}`;
export const SetDataProviderConfigurationDocument = `
    mutation SetDataProviderConfiguration($input: SetDataProviderConfigurationInput!) {
  setDataProviderConfiguration(input: $input) {
    __typename
    ... on DataProviderConfiguration {
      ...DataProviderConfigurationFields
    }
    ... on DataProviderConfigInvalid {
      message
    }
  }
}
    ${DataProviderConfigurationFieldsFragmentDoc}`;
export const ListOrganizationDataProvidersDocument = `
    query ListOrganizationDataProviders($after: String, $before: String, $limit: Int, $order: PaginationOrder) {
  organizationDataProviders(
    after: $after
    before: $before
    limit: $limit
    order: $order
  ) {
    data {
      ...OrganizationDataProviderFields
    }
    listMetadata {
      after
      before
    }
  }
}
    ${OrganizationDataProviderFieldsFragmentDoc}`;
export const SetOrganizationDataProviderConfigurationDocument = `
    mutation SetOrganizationDataProviderConfiguration($input: SetOrganizationDataProviderConfigurationInput!) {
  setOrganizationDataProviderConfiguration(input: $input) {
    __typename
    ... on DataProviderConfiguration {
      ...DataProviderConfigurationFields
    }
    ... on DataProviderConfigInvalid {
      message
    }
  }
}
    ${DataProviderConfigurationFieldsFragmentDoc}`;
export const CreateOrganizationDataProviderConnectionDocument = `
    mutation CreateOrganizationDataProviderConnection($input: CreateOrganizationDataProviderConnectionInput!) {
  createOrganizationDataProviderConnection(input: $input) {
    ...DataProviderConnectionFields
  }
}
    ${DataProviderConnectionFieldsFragmentDoc}`;
export const ConnectOrganizationDataProviderWithClientCredentialsDocument = `
    mutation ConnectOrganizationDataProviderWithClientCredentials($input: ConnectOrganizationDataProviderWithClientCredentialsInput!) {
  connectOrganizationDataProviderWithClientCredentials(input: $input) {
    __typename
    ... on DataProviderConnected {
      connection {
        ...DataProviderConnectionFields
      }
    }
    ... on DataProviderAuthMethodUnsupported {
      authMethod
      supportedAuthMethods
    }
    ... on DataProviderConnectionAuthMethodConflict {
      existingAuthMethod
    }
    ... on DataProviderConfigInvalid {
      message
    }
  }
}
    ${DataProviderConnectionFieldsFragmentDoc}`;
export const DeleteOrganizationDataProviderConnectionDocument = `
    mutation DeleteOrganizationDataProviderConnection($id: ID!) {
  deleteOrganizationDataProviderConnection(id: $id)
}
    `;
export const UpdateDataProviderConnectionLabelDocument = `
    mutation UpdateDataProviderConnectionLabel($input: UpdateDataProviderConnectionLabelInput!) {
  updateDataProviderConnectionLabel(input: $input) {
    ...DataProviderConnectionLabelResultFields
  }
}
    ${DataProviderConnectionLabelResultFieldsFragmentDoc}`;
export const UpdateOrganizationDataProviderConnectionLabelDocument = `
    mutation UpdateOrganizationDataProviderConnectionLabel($input: UpdateDataProviderConnectionLabelInput!) {
  updateOrganizationDataProviderConnectionLabel(input: $input) {
    ...DataProviderConnectionLabelResultFields
  }
}
    ${DataProviderConnectionLabelResultFieldsFragmentDoc}`;
export const RegisterPasskeyDocument = `
    mutation RegisterPasskey($input: RegisterPasskeyInput!) {
  registerPasskey(input: $input) {
    __typename
    ... on PasskeyRegistrationOptions {
      challengeId
      options
    }
    ... on ElevatedAccessTokenExpired {
      message
    }
    ... on ElevatedAccessTokenInvalid {
      message
    }
  }
}
    `;
export const VerifyPasskeyDocument = `
    mutation VerifyPasskey($input: VerifyPasskeyInput!) {
  verifyPasskey(input: $input) {
    __typename
    ... on PasskeyVerified {
      success
    }
    ... on PasskeyChallengeNotFound {
      _placeholder
    }
    ... on PasskeyVerificationFailed {
      _placeholder
    }
    ... on ElevatedAccessTokenExpired {
      message
    }
    ... on ElevatedAccessTokenInvalid {
      message
    }
  }
}
    `;
export const DeletePasskeyDocument = `
    mutation DeletePasskey($input: DeletePasskeyInput!) {
  deletePasskey(input: $input) {
    __typename
    ... on PasskeyDeleted {
      success
    }
    ... on PasskeyNotFound {
      _placeholder
    }
    ... on ElevatedAccessTokenExpired {
      message
    }
    ... on ElevatedAccessTokenInvalid {
      message
    }
  }
}
    `;
export const CreateAdminPortalLinkDocument = `
    mutation CreateAdminPortalLink($intent: AdminPortalLinkIntent!) {
  createAdminPortalLink(intent: $intent) {
    link
    intent
    expiresAt
  }
}
    `;
export const AuditLogStreamDocument = `
    query AuditLogStream {
  auditLogStream {
    id
    auditLogTrailId
    type
    state
    errorMessage
    lastSyncedEventId
  }
}
    `;
export const BrandingDocument = `
    query Branding {
  branding {
    displayName
    logoLightPath
    logoDarkPath
    logoLightIconPath
    logoDarkIconPath
  }
}
    `;
export const AuthKitSettingsDocument = `
    query AuthKitSettings {
  authkitSettings {
    origin
  }
}
    `;
export const ListPermissionsDocument = `
    query ListPermissions($after: String, $before: String, $limit: Int, $order: PaginationOrder, $search: String) {
  permissions(
    after: $after
    before: $before
    limit: $limit
    order: $order
    search: $search
  ) {
    data {
      id
      slug
      name
      description
      system
      createdAt
      updatedAt
    }
    listMetadata {
      after
      before
    }
  }
}
    `;
export const ListApiKeyPermissionsDocument = `
    query ListApiKeyPermissions($apiKeyOwnerType: ApiKeyOwnerType!, $after: String, $before: String, $limit: Int, $search: String) {
  permissions(
    filter: {apiKeyOwnerType: $apiKeyOwnerType, heldByCaller: true}
    after: $after
    before: $before
    limit: $limit
    search: $search
  ) {
    data {
      id
      slug
      name
      description
    }
    listMetadata {
      after
      before
    }
  }
}
    `;
export const GetOrganizationDomainDocument = `
    query GetOrganizationDomain($id: ID!) {
  organizationDomain(id: $id) {
    ...OrganizationDomainFields
  }
}
    ${OrganizationDomainFieldsFragmentDoc}`;
export const ListSharedDataProvidersDocument = `
    query ListSharedDataProviders($after: String, $before: String, $limit: Int, $order: PaginationOrder, $supportsMultipleConnections: Boolean) {
  sharedDataProviders(
    after: $after
    before: $before
    limit: $limit
    order: $order
    supportsMultipleConnections: $supportsMultipleConnections
  ) {
    data {
      ...SharedDataProviderFields
    }
    listMetadata {
      after
      before
    }
  }
}
    ${SharedDataProviderFieldsFragmentDoc}`;
export const ListConfigurableDataProvidersDocument = `
    query ListConfigurableDataProviders($after: String, $before: String, $limit: Int, $order: PaginationOrder) {
  configurableDataProviders(
    after: $after
    before: $before
    limit: $limit
    order: $order
  ) {
    data {
      ...ConfigurableDataProviderFields
    }
    listMetadata {
      after
      before
    }
  }
}
    ${ConfigurableDataProviderFieldsFragmentDoc}`;
export const ListOrganizationApiKeysDocument = `
    query ListOrganizationApiKeys($after: String, $before: String, $limit: Int, $order: PaginationOrder, $search: String) {
  organizationApiKeys(
    after: $after
    before: $before
    limit: $limit
    order: $order
    search: $search
  ) {
    data {
      ...OrganizationApiKeyFields
    }
    listMetadata {
      after
      before
    }
  }
}
    ${OrganizationApiKeyFieldsFragmentDoc}`;
export const ListUserApiKeysDocument = `
    query ListUserApiKeys($after: String, $before: String, $limit: Int, $order: PaginationOrder, $search: String) {
  userApiKeys(
    after: $after
    before: $before
    limit: $limit
    order: $order
    search: $search
  ) {
    data {
      ...UserApiKeyFields
    }
    listMetadata {
      after
      before
    }
  }
}
    ${UserApiKeyFieldsFragmentDoc}`;
export const CreateOrganizationApiKeyDocument = `
    mutation CreateOrganizationApiKey($input: CreateApiKeyInput!) {
  createOrganizationApiKey(input: $input) {
    __typename
    ... on OrganizationApiKeyCreated {
      value
      apiKey {
        ...OrganizationApiKeyFields
      }
    }
    ... on ApiKeyPermissionsNotHeld {
      message
      unheldPermissions
    }
    ... on ApiKeyPermissionsUnsupportedForToken {
      message
      requestedPermissions
    }
    ... on InvalidApiKeyExpiration {
      message
    }
    ... on InvalidApiKeyName {
      message
    }
    ... on InvalidApiKeyPermissions {
      message
      invalidPermissions
    }
  }
}
    ${OrganizationApiKeyFieldsFragmentDoc}`;
export const CreateUserApiKeyDocument = `
    mutation CreateUserApiKey($input: CreateApiKeyInput!) {
  createUserApiKey(input: $input) {
    __typename
    ... on UserApiKeyCreated {
      value
      apiKey {
        ...UserApiKeyFields
      }
    }
    ... on ApiKeyPermissionsNotHeld {
      message
      unheldPermissions
    }
    ... on ApiKeyPermissionsUnsupportedForToken {
      message
      requestedPermissions
    }
    ... on InvalidApiKeyExpiration {
      message
    }
    ... on InvalidApiKeyName {
      message
    }
    ... on InvalidApiKeyPermissions {
      message
      invalidPermissions
    }
  }
}
    ${UserApiKeyFieldsFragmentDoc}`;
export const ExpireOrganizationApiKeyDocument = `
    mutation ExpireOrganizationApiKey($input: ExpireApiKeyInput!) {
  expireOrganizationApiKey(input: $input) {
    __typename
    ... on OrganizationApiKeyExpired {
      apiKey {
        ...OrganizationApiKeyFields
      }
    }
    ... on ApiKeyAlreadyExpired {
      apiKeyId
    }
  }
}
    ${OrganizationApiKeyFieldsFragmentDoc}`;
export const ExpireUserApiKeyDocument = `
    mutation ExpireUserApiKey($input: ExpireApiKeyInput!) {
  expireUserApiKey(input: $input) {
    __typename
    ... on UserApiKeyExpired {
      apiKey {
        ...UserApiKeyFields
      }
    }
    ... on ApiKeyAlreadyExpired {
      apiKeyId
    }
  }
}
    ${UserApiKeyFieldsFragmentDoc}`;
export const DeleteOrganizationApiKeyDocument = `
    mutation DeleteOrganizationApiKey($apiKeyId: ID!) {
  deleteOrganizationApiKey(apiKeyId: $apiKeyId) {
    ...OrganizationApiKeyFields
  }
}
    ${OrganizationApiKeyFieldsFragmentDoc}`;
export const DeleteUserApiKeyDocument = `
    mutation DeleteUserApiKey($apiKeyId: ID!) {
  deleteUserApiKey(apiKeyId: $apiKeyId) {
    ...UserApiKeyFields
  }
}
    ${UserApiKeyFieldsFragmentDoc}`;

export type SdkFunctionWrapper = <T>(
  action: (requestHeaders?: Record<string, string>) => Promise<T>,
  operationName: string,
  operationType?: string,
  variables?: any,
) => Promise<T>;

const defaultWrapper: SdkFunctionWrapper = (
  action,
  _operationName,
  _operationType,
  _variables,
) => action();

export function getSdk(
  client: GraphQLClient,
  withWrapper: SdkFunctionWrapper = defaultWrapper,
) {
  return {
    ClientApiStatus(
      variables?: ClientApiStatusQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ClientApiStatusQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ClientApiStatusQuery>({
            document: ClientApiStatusDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ClientApiStatus",
        "query",
        variables,
      );
    },
    ListOrganizationDomains(
      variables?: ListOrganizationDomainsQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListOrganizationDomainsQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListOrganizationDomainsQuery>({
            document: ListOrganizationDomainsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListOrganizationDomains",
        "query",
        variables,
      );
    },
    CreateOrganizationDomain(
      variables: CreateOrganizationDomainMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<CreateOrganizationDomainMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<CreateOrganizationDomainMutation>({
            document: CreateOrganizationDomainDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "CreateOrganizationDomain",
        "mutation",
        variables,
      );
    },
    DeleteOrganizationDomain(
      variables: DeleteOrganizationDomainMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<DeleteOrganizationDomainMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<DeleteOrganizationDomainMutation>({
            document: DeleteOrganizationDomainDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "DeleteOrganizationDomain",
        "mutation",
        variables,
      );
    },
    ReverifyOrganizationDomain(
      variables: ReverifyOrganizationDomainMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ReverifyOrganizationDomainMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ReverifyOrganizationDomainMutation>({
            document: ReverifyOrganizationDomainDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ReverifyOrganizationDomain",
        "mutation",
        variables,
      );
    },
    Me(
      variables?: MeQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<MeQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<MeQuery>({
            document: MeDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "Me",
        "query",
        variables,
      );
    },
    AuthenticationSettings(
      variables?: AuthenticationSettingsQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<AuthenticationSettingsQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<AuthenticationSettingsQuery>({
            document: AuthenticationSettingsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "AuthenticationSettings",
        "query",
        variables,
      );
    },
    Passkeys(
      variables?: PasskeysQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<PasskeysQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<PasskeysQuery>({
            document: PasskeysDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "Passkeys",
        "query",
        variables,
      );
    },
    UpdateProfile(
      variables: UpdateProfileMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<UpdateProfileMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<UpdateProfileMutation>({
            document: UpdateProfileDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "UpdateProfile",
        "mutation",
        variables,
      );
    },
    SendVerificationCode(
      variables?: SendVerificationCodeMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<SendVerificationCodeMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<SendVerificationCodeMutation>({
            document: SendVerificationCodeDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "SendVerificationCode",
        "mutation",
        variables,
      );
    },
    VerifyCurrentEmail(
      variables: VerifyCurrentEmailMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<VerifyCurrentEmailMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<VerifyCurrentEmailMutation>({
            document: VerifyCurrentEmailDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "VerifyCurrentEmail",
        "mutation",
        variables,
      );
    },
    SendEmailChange(
      variables: SendEmailChangeMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<SendEmailChangeMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<SendEmailChangeMutation>({
            document: SendEmailChangeDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "SendEmailChange",
        "mutation",
        variables,
      );
    },
    ConfirmEmailChange(
      variables: ConfirmEmailChangeMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ConfirmEmailChangeMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ConfirmEmailChangeMutation>({
            document: ConfirmEmailChangeDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ConfirmEmailChange",
        "mutation",
        variables,
      );
    },
    CreatePassword(
      variables: CreatePasswordMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<CreatePasswordMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<CreatePasswordMutation>({
            document: CreatePasswordDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "CreatePassword",
        "mutation",
        variables,
      );
    },
    UpdatePassword(
      variables: UpdatePasswordMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<UpdatePasswordMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<UpdatePasswordMutation>({
            document: UpdatePasswordDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "UpdatePassword",
        "mutation",
        variables,
      );
    },
    EnrollTotp(
      variables: EnrollTotpMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<EnrollTotpMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<EnrollTotpMutation>({
            document: EnrollTotpDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "EnrollTotp",
        "mutation",
        variables,
      );
    },
    VerifyTotp(
      variables: VerifyTotpMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<VerifyTotpMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<VerifyTotpMutation>({
            document: VerifyTotpDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "VerifyTotp",
        "mutation",
        variables,
      );
    },
    RemoveMfaFactor(
      variables: RemoveMfaFactorMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<RemoveMfaFactorMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<RemoveMfaFactorMutation>({
            document: RemoveMfaFactorDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "RemoveMfaFactor",
        "mutation",
        variables,
      );
    },
    Sessions(
      variables?: SessionsQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<SessionsQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<SessionsQuery>({
            document: SessionsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "Sessions",
        "query",
        variables,
      );
    },
    RevokeSession(
      variables: RevokeSessionMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<RevokeSessionMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<RevokeSessionMutation>({
            document: RevokeSessionDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "RevokeSession",
        "mutation",
        variables,
      );
    },
    RevokeAllSessions(
      variables?: RevokeAllSessionsMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<RevokeAllSessionsMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<RevokeAllSessionsMutation>({
            document: RevokeAllSessionsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "RevokeAllSessions",
        "mutation",
        variables,
      );
    },
    ListOrganizationMemberships(
      variables?: ListOrganizationMembershipsQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListOrganizationMembershipsQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListOrganizationMembershipsQuery>({
            document: ListOrganizationMembershipsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListOrganizationMemberships",
        "query",
        variables,
      );
    },
    ListRoles(
      variables?: ListRolesQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListRolesQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListRolesQuery>({
            document: ListRolesDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListRoles",
        "query",
        variables,
      );
    },
    InviteUser(
      variables: InviteUserMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<InviteUserMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<InviteUserMutation>({
            document: InviteUserDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "InviteUser",
        "mutation",
        variables,
      );
    },
    UpdateMemberRole(
      variables: UpdateMemberRoleMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<UpdateMemberRoleMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<UpdateMemberRoleMutation>({
            document: UpdateMemberRoleDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "UpdateMemberRole",
        "mutation",
        variables,
      );
    },
    RemoveMember(
      variables: RemoveMemberMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<RemoveMemberMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<RemoveMemberMutation>({
            document: RemoveMemberDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "RemoveMember",
        "mutation",
        variables,
      );
    },
    ResendInvitation(
      variables: ResendInvitationMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ResendInvitationMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ResendInvitationMutation>({
            document: ResendInvitationDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ResendInvitation",
        "mutation",
        variables,
      );
    },
    RevokeInvitation(
      variables: RevokeInvitationMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<RevokeInvitationMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<RevokeInvitationMutation>({
            document: RevokeInvitationDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "RevokeInvitation",
        "mutation",
        variables,
      );
    },
    ListUserOrganizations(
      variables?: ListUserOrganizationsQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListUserOrganizationsQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListUserOrganizationsQuery>({
            document: ListUserOrganizationsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListUserOrganizations",
        "query",
        variables,
      );
    },
    ListDirectoryConnections(
      variables?: ListDirectoryConnectionsQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListDirectoryConnectionsQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListDirectoryConnectionsQuery>({
            document: ListDirectoryConnectionsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListDirectoryConnections",
        "query",
        variables,
      );
    },
    GetDirectoryConnection(
      variables: GetDirectoryConnectionQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<GetDirectoryConnectionQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<GetDirectoryConnectionQuery>({
            document: GetDirectoryConnectionDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "GetDirectoryConnection",
        "query",
        variables,
      );
    },
    ListSsoConnections(
      variables?: ListSsoConnectionsQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListSsoConnectionsQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListSsoConnectionsQuery>({
            document: ListSsoConnectionsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListSsoConnections",
        "query",
        variables,
      );
    },
    GetSsoConnection(
      variables: GetSsoConnectionQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<GetSsoConnectionQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<GetSsoConnectionQuery>({
            document: GetSsoConnectionDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "GetSsoConnection",
        "query",
        variables,
      );
    },
    ListDataProviders(
      variables?: ListDataProvidersQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListDataProvidersQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListDataProvidersQuery>({
            document: ListDataProvidersDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListDataProviders",
        "query",
        variables,
      );
    },
    ListDataProviderConnections(
      variables?: ListDataProviderConnectionsQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListDataProviderConnectionsQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListDataProviderConnectionsQuery>({
            document: ListDataProviderConnectionsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListDataProviderConnections",
        "query",
        variables,
      );
    },
    CreateDataProviderConnection(
      variables: CreateDataProviderConnectionMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<CreateDataProviderConnectionMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<CreateDataProviderConnectionMutation>({
            document: CreateDataProviderConnectionDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "CreateDataProviderConnection",
        "mutation",
        variables,
      );
    },
    DeleteDataProviderConnection(
      variables: DeleteDataProviderConnectionMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<DeleteDataProviderConnectionMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<DeleteDataProviderConnectionMutation>({
            document: DeleteDataProviderConnectionDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "DeleteDataProviderConnection",
        "mutation",
        variables,
      );
    },
    SetDataProviderEnabled(
      variables: SetDataProviderEnabledMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<SetDataProviderEnabledMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<SetDataProviderEnabledMutation>({
            document: SetDataProviderEnabledDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "SetDataProviderEnabled",
        "mutation",
        variables,
      );
    },
    CreateDataProviderAuthorization(
      variables: CreateDataProviderAuthorizationMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<CreateDataProviderAuthorizationMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<CreateDataProviderAuthorizationMutation>({
            document: CreateDataProviderAuthorizationDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "CreateDataProviderAuthorization",
        "mutation",
        variables,
      );
    },
    CreateOrganizationDataProviderAuthorization(
      variables: CreateOrganizationDataProviderAuthorizationMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<CreateOrganizationDataProviderAuthorizationMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<CreateOrganizationDataProviderAuthorizationMutation>({
            document: CreateOrganizationDataProviderAuthorizationDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "CreateOrganizationDataProviderAuthorization",
        "mutation",
        variables,
      );
    },
    DataProviderAuthorizationStatus(
      variables: DataProviderAuthorizationStatusQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<DataProviderAuthorizationStatusQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<DataProviderAuthorizationStatusQuery>({
            document: DataProviderAuthorizationStatusDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "DataProviderAuthorizationStatus",
        "query",
        variables,
      );
    },
    ConnectDataProviderWithClientCredentials(
      variables: ConnectDataProviderWithClientCredentialsMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ConnectDataProviderWithClientCredentialsMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ConnectDataProviderWithClientCredentialsMutation>({
            document: ConnectDataProviderWithClientCredentialsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ConnectDataProviderWithClientCredentials",
        "mutation",
        variables,
      );
    },
    SetDataProviderConfiguration(
      variables: SetDataProviderConfigurationMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<SetDataProviderConfigurationMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<SetDataProviderConfigurationMutation>({
            document: SetDataProviderConfigurationDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "SetDataProviderConfiguration",
        "mutation",
        variables,
      );
    },
    ListOrganizationDataProviders(
      variables?: ListOrganizationDataProvidersQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListOrganizationDataProvidersQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListOrganizationDataProvidersQuery>({
            document: ListOrganizationDataProvidersDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListOrganizationDataProviders",
        "query",
        variables,
      );
    },
    SetOrganizationDataProviderConfiguration(
      variables: SetOrganizationDataProviderConfigurationMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<SetOrganizationDataProviderConfigurationMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<SetOrganizationDataProviderConfigurationMutation>({
            document: SetOrganizationDataProviderConfigurationDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "SetOrganizationDataProviderConfiguration",
        "mutation",
        variables,
      );
    },
    CreateOrganizationDataProviderConnection(
      variables: CreateOrganizationDataProviderConnectionMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<CreateOrganizationDataProviderConnectionMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<CreateOrganizationDataProviderConnectionMutation>({
            document: CreateOrganizationDataProviderConnectionDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "CreateOrganizationDataProviderConnection",
        "mutation",
        variables,
      );
    },
    ConnectOrganizationDataProviderWithClientCredentials(
      variables: ConnectOrganizationDataProviderWithClientCredentialsMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ConnectOrganizationDataProviderWithClientCredentialsMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ConnectOrganizationDataProviderWithClientCredentialsMutation>(
            {
              document:
                ConnectOrganizationDataProviderWithClientCredentialsDocument,
              variables,
              requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
              signal,
            },
          ),
        "ConnectOrganizationDataProviderWithClientCredentials",
        "mutation",
        variables,
      );
    },
    DeleteOrganizationDataProviderConnection(
      variables: DeleteOrganizationDataProviderConnectionMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<DeleteOrganizationDataProviderConnectionMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<DeleteOrganizationDataProviderConnectionMutation>({
            document: DeleteOrganizationDataProviderConnectionDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "DeleteOrganizationDataProviderConnection",
        "mutation",
        variables,
      );
    },
    UpdateDataProviderConnectionLabel(
      variables: UpdateDataProviderConnectionLabelMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<UpdateDataProviderConnectionLabelMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<UpdateDataProviderConnectionLabelMutation>({
            document: UpdateDataProviderConnectionLabelDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "UpdateDataProviderConnectionLabel",
        "mutation",
        variables,
      );
    },
    UpdateOrganizationDataProviderConnectionLabel(
      variables: UpdateOrganizationDataProviderConnectionLabelMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<UpdateOrganizationDataProviderConnectionLabelMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<UpdateOrganizationDataProviderConnectionLabelMutation>(
            {
              document: UpdateOrganizationDataProviderConnectionLabelDocument,
              variables,
              requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
              signal,
            },
          ),
        "UpdateOrganizationDataProviderConnectionLabel",
        "mutation",
        variables,
      );
    },
    RegisterPasskey(
      variables: RegisterPasskeyMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<RegisterPasskeyMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<RegisterPasskeyMutation>({
            document: RegisterPasskeyDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "RegisterPasskey",
        "mutation",
        variables,
      );
    },
    VerifyPasskey(
      variables: VerifyPasskeyMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<VerifyPasskeyMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<VerifyPasskeyMutation>({
            document: VerifyPasskeyDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "VerifyPasskey",
        "mutation",
        variables,
      );
    },
    DeletePasskey(
      variables: DeletePasskeyMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<DeletePasskeyMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<DeletePasskeyMutation>({
            document: DeletePasskeyDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "DeletePasskey",
        "mutation",
        variables,
      );
    },
    CreateAdminPortalLink(
      variables: CreateAdminPortalLinkMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<CreateAdminPortalLinkMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<CreateAdminPortalLinkMutation>({
            document: CreateAdminPortalLinkDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "CreateAdminPortalLink",
        "mutation",
        variables,
      );
    },
    AuditLogStream(
      variables?: AuditLogStreamQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<AuditLogStreamQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<AuditLogStreamQuery>({
            document: AuditLogStreamDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "AuditLogStream",
        "query",
        variables,
      );
    },
    Branding(
      variables?: BrandingQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<BrandingQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<BrandingQuery>({
            document: BrandingDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "Branding",
        "query",
        variables,
      );
    },
    AuthKitSettings(
      variables?: AuthKitSettingsQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<AuthKitSettingsQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<AuthKitSettingsQuery>({
            document: AuthKitSettingsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "AuthKitSettings",
        "query",
        variables,
      );
    },
    ListPermissions(
      variables?: ListPermissionsQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListPermissionsQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListPermissionsQuery>({
            document: ListPermissionsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListPermissions",
        "query",
        variables,
      );
    },
    ListApiKeyPermissions(
      variables: ListApiKeyPermissionsQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListApiKeyPermissionsQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListApiKeyPermissionsQuery>({
            document: ListApiKeyPermissionsDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListApiKeyPermissions",
        "query",
        variables,
      );
    },
    GetOrganizationDomain(
      variables: GetOrganizationDomainQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<GetOrganizationDomainQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<GetOrganizationDomainQuery>({
            document: GetOrganizationDomainDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "GetOrganizationDomain",
        "query",
        variables,
      );
    },
    ListSharedDataProviders(
      variables?: ListSharedDataProvidersQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListSharedDataProvidersQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListSharedDataProvidersQuery>({
            document: ListSharedDataProvidersDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListSharedDataProviders",
        "query",
        variables,
      );
    },
    ListConfigurableDataProviders(
      variables?: ListConfigurableDataProvidersQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListConfigurableDataProvidersQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListConfigurableDataProvidersQuery>({
            document: ListConfigurableDataProvidersDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListConfigurableDataProviders",
        "query",
        variables,
      );
    },
    ListOrganizationApiKeys(
      variables?: ListOrganizationApiKeysQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListOrganizationApiKeysQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListOrganizationApiKeysQuery>({
            document: ListOrganizationApiKeysDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListOrganizationApiKeys",
        "query",
        variables,
      );
    },
    ListUserApiKeys(
      variables?: ListUserApiKeysQueryVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ListUserApiKeysQuery> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ListUserApiKeysQuery>({
            document: ListUserApiKeysDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ListUserApiKeys",
        "query",
        variables,
      );
    },
    CreateOrganizationApiKey(
      variables: CreateOrganizationApiKeyMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<CreateOrganizationApiKeyMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<CreateOrganizationApiKeyMutation>({
            document: CreateOrganizationApiKeyDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "CreateOrganizationApiKey",
        "mutation",
        variables,
      );
    },
    CreateUserApiKey(
      variables: CreateUserApiKeyMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<CreateUserApiKeyMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<CreateUserApiKeyMutation>({
            document: CreateUserApiKeyDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "CreateUserApiKey",
        "mutation",
        variables,
      );
    },
    ExpireOrganizationApiKey(
      variables: ExpireOrganizationApiKeyMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ExpireOrganizationApiKeyMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ExpireOrganizationApiKeyMutation>({
            document: ExpireOrganizationApiKeyDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ExpireOrganizationApiKey",
        "mutation",
        variables,
      );
    },
    ExpireUserApiKey(
      variables: ExpireUserApiKeyMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<ExpireUserApiKeyMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<ExpireUserApiKeyMutation>({
            document: ExpireUserApiKeyDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "ExpireUserApiKey",
        "mutation",
        variables,
      );
    },
    DeleteOrganizationApiKey(
      variables: DeleteOrganizationApiKeyMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<DeleteOrganizationApiKeyMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<DeleteOrganizationApiKeyMutation>({
            document: DeleteOrganizationApiKeyDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "DeleteOrganizationApiKey",
        "mutation",
        variables,
      );
    },
    DeleteUserApiKey(
      variables: DeleteUserApiKeyMutationVariables,
      requestHeaders?: GraphQLClientRequestHeaders,
      signal?: RequestInit["signal"],
    ): Promise<DeleteUserApiKeyMutation> {
      return withWrapper(
        (wrappedRequestHeaders) =>
          client.request<DeleteUserApiKeyMutation>({
            document: DeleteUserApiKeyDocument,
            variables,
            requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders },
            signal,
          }),
        "DeleteUserApiKey",
        "mutation",
        variables,
      );
    },
  };
}
export type Sdk = ReturnType<typeof getSdk>;
