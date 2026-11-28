// Better Auth's tables (core, organization, API key and SCIM plugins), in the
// shape `pnpm --filter @preprocess/api auth:generate` writes from
// apps/api/src/auth.ts.
// Do not change their shape by hand: add columns through Better Auth's
// additionalFields and regenerate (design doc 01).

import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  // "First Last", kept for every existing reader; firstName and lastName are
  // what the person entered (null for people who joined before they existed).
  name: text("name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  // Set when a directory or an Owner deactivates the person; sign-in is refused
  // while it is set (PLAT-27: Better Auth only deletes sessions).
  deactivatedAt: timestamp("deactivated_at"),
  // One switch per person, across organizations: notification email for
  // tags, waits and assignments (design doc 06). The inbox ignores it.
  emailNotifications: boolean("email_notifications").default(true).notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull(),
  metadata: text("metadata"),
  createdBy: text("created_by"),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

// Organization-wide keys only (mvp-surface): referenceId is the organization.
export const apikey = pgTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").default("default").notNull(),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id").notNull(),
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at"),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
    rateLimitMax: integer("rate_limit_max").default(10),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_configId_idx").on(table.configId),
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ],
);

// Device authorization plugin: one row per `preprocess login` attempt, from
// the code the CLI asks for until it is approved, denied or expires.
export const deviceCode = pgTable("device_code", {
  id: text("id").primaryKey(),
  deviceCode: text("device_code").notNull().unique(),
  userCode: text("user_code").notNull().unique(),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  status: text("status").notNull(),
  lastPolledAt: timestamp("last_polled_at"),
  pollingInterval: integer("polling_interval"),
  clientId: text("client_id"),
  scope: text("scope"),
});

// SCIM plugin (@better-auth/scim): directory sync. One managed connection per
// organization (provisioning domain = organization id), its hashed bearer
// credentials, and the users and groups each connection provisioned. Read and
// written only through the plugin's adapter, except the projection into
// members and groups in apps/api/src/scim.ts.
export const scimManagedConnection = pgTable(
  "scim_managed_connection",
  {
    id: text("id").primaryKey(),
    creationRequestId: text("creation_request_id").notNull().unique(),
    connectionId: text("connection_id").notNull().unique(),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    status: text("status").notNull(),
    revision: integer("revision").notNull(),
    createdAt: timestamp("created_at").notNull(),
    createdBy: text("created_by").notNull(),
    decommissionStartedAt: timestamp("decommission_started_at"),
    decommissionStartedBy: text("decommission_started_by"),
    decommissionedAt: timestamp("decommissioned_at"),
    decommissionedBy: text("decommissioned_by"),
  },
  (table) => [
    index("scimManagedConnection_provisioningDomainId_idx").on(
      table.provisioningDomainId,
    ),
  ],
);

export const scimManagedCredential = pgTable(
  "scim_managed_credential",
  {
    id: text("id").primaryKey(),
    connectionRecordId: text("connection_record_id")
      .notNull()
      .references(() => scimManagedConnection.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    tokenDigest: text("token_digest").notNull(),
    hashVersion: text("hash_version").notNull(),
    activeSlotKey: text("active_slot_key").notNull().unique(),
    status: text("status").notNull(),
    serializedScopes: text("serialized_scopes").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    createdBy: text("created_by").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    revokedBy: text("revoked_by"),
    decommissionedAt: timestamp("decommissioned_at"),
  },
  (table) => [
    index("scimManagedCredential_connectionRecordId_idx").on(
      table.connectionRecordId,
    ),
  ],
);

export const scimManagedConnectionEvent = pgTable(
  "scim_managed_connection_event",
  {
    id: text("id").primaryKey(),
    connectionRecordId: text("connection_record_id")
      .notNull()
      .references(() => scimManagedConnection.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull().unique(),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    actorId: text("actor_id").notNull(),
    credentialId: text("credential_id"),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("scimManagedConnectionEvent_connectionRecordId_idx").on(
      table.connectionRecordId,
    ),
  ],
);

export const scimConnectionBinding = pgTable(
  "scim_connection_binding",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    connectionKey: text("connection_key").notNull().unique(),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    createdAt: timestamp("created_at").notNull(),
    decommissionedAt: timestamp("decommissioned_at"),
    decommissionStatus: text("decommission_status").default("active").notNull(),
    decommissionCursorUserId: text("decommission_cursor_user_id"),
    decommissionReconciledUserCount: integer(
      "decommission_reconciled_user_count",
    )
      .default(0)
      .notNull(),
    decommissionBatchCount: integer("decommission_batch_count")
      .default(0)
      .notNull(),
    decommissionRevision: integer("decommission_revision").default(0).notNull(),
    decommissionCompletedAt: timestamp("decommission_completed_at"),
    decommissionLeaseId: text("decommission_lease_id"),
    decommissionLeaseExpiresAt: timestamp("decommission_lease_expires_at"),
  },
  (table) => [
    index("scimConnectionBinding_connectionId_idx").on(table.connectionId),
  ],
);

export const scimIdentityTombstone = pgTable(
  "scim_identity_tombstone",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    externalId: text("external_id").notNull(),
    externalIdKey: text("external_id_key").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    profile: text("profile").notNull(),
    deletedAt: timestamp("deleted_at").notNull(),
  },
  (table) => [
    index("scimIdentityTombstone_connectionId_idx").on(table.connectionId),
    index("scimIdentityTombstone_provisioningDomainId_idx").on(
      table.provisioningDomainId,
    ),
    index("scimIdentityTombstone_userId_idx").on(table.userId),
  ],
);

export const scimSubject = pgTable(
  "scim_subject",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    profileSourceId: text("profile_source_id"),
    revision: integer("revision").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("scimSubject_profileSourceId_idx").on(table.profileSourceId),
  ],
);

export const scimUser = pgTable(
  "scim_user",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    connectionUserKey: text("connection_user_key").notNull().unique(),
    userName: text("user_name").notNull(),
    userNameKey: text("user_name_key").notNull().unique(),
    primaryEmail: text("primary_email").notNull(),
    workEmailValueIndex: text("work_email_value_index").notNull(),
    emailValueIndex: text("email_value_index").notNull(),
    displayName: text("display_name").notNull(),
    formattedName: text("formatted_name").notNull(),
    givenName: text("given_name"),
    familyName: text("family_name"),
    serializedEmails: text("serialized_emails").notNull(),
    serializedAttributes: text("serialized_attributes"),
    externalId: text("external_id"),
    externalIdKey: text("external_id_key").unique(),
    active: boolean("active").notNull(),
    orderKey: text("order_key").notNull().unique(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("scimUser_connectionId_idx").on(table.connectionId),
    index("scimUser_provisioningDomainId_idx").on(table.provisioningDomainId),
    index("scimUser_userId_idx").on(table.userId),
  ],
);

export const scimProjectionGrant = pgTable(
  "scim_projection_grant",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    scimUserId: text("scim_user_id")
      .notNull()
      .references(() => scimUser.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    sourceValue: text("source_value"),
    role: text("role").notNull(),
    grantKey: text("grant_key").notNull().unique(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("scimProjectionGrant_connectionId_idx").on(table.connectionId),
    index("scimProjectionGrant_provisioningDomainId_idx").on(
      table.provisioningDomainId,
    ),
    index("scimProjectionGrant_scimUserId_idx").on(table.scimUserId),
    index("scimProjectionGrant_userId_idx").on(table.userId),
  ],
);

export const scimGroup = pgTable(
  "scim_group",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    revision: integer("revision").default(0).notNull(),
    displayName: text("display_name").notNull(),
    displayNameKey: text("display_name_key").notNull().unique(),
    externalId: text("external_id"),
    externalIdKey: text("external_id_key").unique(),
    orderKey: text("order_key").notNull().unique(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("scimGroup_connectionId_idx").on(table.connectionId),
    index("scimGroup_provisioningDomainId_idx").on(table.provisioningDomainId),
  ],
);

export const scimGroupMember = pgTable(
  "scim_group_member",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    groupId: text("group_id")
      .notNull()
      .references(() => scimGroup.id, { onDelete: "cascade" }),
    scimUserId: text("scim_user_id")
      .notNull()
      .references(() => scimUser.id, { onDelete: "cascade" }),
    membershipKey: text("membership_key").notNull().unique(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("scimGroupMember_connectionId_idx").on(table.connectionId),
    index("scimGroupMember_groupId_idx").on(table.groupId),
    index("scimGroupMember_scimUserId_idx").on(table.scimUserId),
  ],
);

// SSO plugin: one connection per organization (spec 13), SAML or OIDC. The
// domain proves itself by a DNS TXT record before anyone signs in through it.
// `enforced` turns every other way in off for addresses at the domain, except
// for the organization's Owners; `jit` adds a person to the organization the
// first time they sign in through it.
export const ssoProvider = pgTable(
  "sso_provider",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    oidcConfig: text("oidc_config"),
    samlConfig: text("saml_config"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull().unique(),
    organizationId: text("organization_id"),
    domain: text("domain").notNull(),
    domainVerified: boolean("domain_verified"),
    enforced: boolean("enforced").default(false).notNull(),
    jit: boolean("jit").default(true).notNull(),
  },
  (table) => [
    index("sso_provider_organizationId_idx").on(table.organizationId),
  ],
);
