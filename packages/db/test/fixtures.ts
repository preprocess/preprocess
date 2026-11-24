// Two organizations with a row in every tenant table, written through
// DB_SYSTEM (which bypasses RLS), so tests can check what withOrg sees.

import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";

import { orgId, withoutOrg } from "../src/client.ts";
import { audit, startAuditChain } from "../src/audit.ts";
import { newId } from "../src/ids.ts";
import {
  user,
  organization,
  member,
  invitation,
  apikey,
} from "../src/schema/auth.ts";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "../src/schema/access.ts";
import {
  caseAssignees,
  caseMentions,
  cases,
  files,
  idempotencyKeys,
  inboxReads,
  outbox,
  reviewEvents,
} from "../src/schema/cases.ts";
import {
  deploymentGroups,
  deployments,
  secretDeliveries,
  secretGrants,
} from "../src/schema/deployments.ts";
import {
  agentNetworkRules,
  guardrailRequests,
  organizationGuardrails,
} from "../src/schema/guardrails.ts";
import { webhookDeliveries, webhookEndpoints } from "../src/schema/webhooks.ts";
import {
  mcpAuthorizations,
  mcpConnections,
  mcpGrants,
  mcpServers,
} from "../src/schema/mcp.ts";
import { orgKeys, secrets } from "../src/schema/secrets.ts";

export type Org = Awaited<ReturnType<typeof seedOrganization>>;

export const seedOrganization = async (name: string) =>
  withoutOrg(env, "test fixture", async (tx) => {
    const now = new Date();
    const org = orgId(newId("organization"));
    const userId = newId("user");
    const groupId = newId("group");
    const developersId = newId("group");
    const agentId = newId("agent");
    const caseId = newId("case");
    await tx.insert(user).values({
      id: userId,
      name: `${name} owner`,
      email: `${userId}@${name.toLowerCase()}.test`,
    });
    await tx.insert(organization).values({
      id: org,
      name,
      slug: org,
      createdAt: now,
      createdBy: userId,
    });
    await startAuditChain(tx, org);
    await tx.insert(member).values({
      id: newId("member"),
      organizationId: org,
      userId,
      role: "owner",
      createdAt: now,
    });
    await tx.insert(invitation).values({
      id: newId("invitation"),
      organizationId: org,
      email: `invitee@${name.toLowerCase()}.test`,
      role: "member",
      expiresAt: new Date(now.getTime() + 86_400_000),
      inviterId: userId,
    });
    await tx.insert(apikey).values({
      id: newId("apikey"),
      referenceId: org,
      key: `hashed-${org}`,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(groups).values([
      {
        id: developersId,
        organizationId: org,
        slug: "developers",
        name: "Developers",
        isDevelopers: true,
      },
      { id: groupId, organizationId: org, slug: "ap-team", name: "AP team" },
    ]);
    await tx
      .insert(groupMembers)
      .values({ organizationId: org, groupId, userId });
    await tx
      .insert(agents)
      .values({ id: agentId, organizationId: org, slug: "invoices" });
    await tx.insert(agentGrants).values({
      organizationId: org,
      agentId,
      groupId,
      access: "operator",
      grantedBy: userId,
    });
    await tx.insert(orgKeys).values({
      organizationId: org,
      version: 1,
      masterKeyId: "secrets-master-v1",
      wrappedKey: new Uint8Array([1, 2, 3]),
    });
    const secretId = newId("secret");
    await tx.insert(secrets).values({
      id: secretId,
      organizationId: org,
      name: "ERP_TOKEN",
      version: 1,
      keyVersion: 1,
      ciphertext: new Uint8Array([4, 5, 6]),
      updatedBy: userId,
    });
    const deploymentId = newId("deployment");
    await tx.insert(deployments).values({
      id: deploymentId,
      organizationId: org,
      agentId,
      environment: "production",
      status: "ready",
      scriptName: deploymentId,
      bundleSha256: "0".repeat(64),
      sdkVersion: "0.1.0",
      network: { allow: ["erp.example.com"], block: [] },
      manifest: {},
      source: "cli",
      createdBy: userId,
      promotedAt: now,
    });
    await tx
      .insert(deploymentGroups)
      .values({ organizationId: org, deploymentId, groupId, approves: true });
    await tx
      .insert(secretGrants)
      .values({ organizationId: org, secretId, agentId, grantedBy: userId });
    await tx.insert(secretDeliveries).values({
      organizationId: org,
      deploymentId,
      secretId,
      secretVersion: 1,
    });
    const serverId = newId("mcpServer");
    await tx.insert(mcpServers).values({
      id: serverId,
      organizationId: org,
      slug: "crm",
      url: "https://crm.example.com/mcp",
      auth: "oauth",
      createdBy: userId,
    });
    await tx
      .insert(mcpGrants)
      .values({ organizationId: org, serverId, agentId, grantedBy: userId });
    await tx.insert(mcpConnections).values({
      id: newId("mcpConnection"),
      organizationId: org,
      serverId,
      version: 1,
      keyVersion: 1,
      ciphertext: new Uint8Array([7, 8, 9]),
      status: "active",
      connectedBy: userId,
    });
    await tx.insert(mcpAuthorizations).values({
      id: newId("mcpAuthorization"),
      organizationId: org,
      serverId,
      codeVerifier: "verifier",
      redirectUri: "https://app.test/v1/mcp/oauth/callback",
      createdBy: userId,
      expiresAt: new Date(now.getTime() + 600_000),
    });
    await tx.insert(cases).values({
      id: caseId,
      organizationId: org,
      agentId,
      deploymentId,
      status: "waiting",
      waitingOnGroupId: groupId,
      source: "api",
    });
    await tx.insert(caseAssignees).values({
      organizationId: org,
      caseId,
      userId,
      assignedBy: userId,
    });
    await tx.insert(idempotencyKeys).values({
      organizationId: org,
      operation: "cases.create",
      key: "key-1",
      fingerprint: new Uint8Array([7]),
      caseId,
      expiresAt: new Date(now.getTime() + 86_400_000),
    });
    await tx.insert(files).values({
      id: newId("file"),
      organizationId: org,
      caseId,
      name: "invoice.pdf",
      contentType: "application/pdf",
      size: 3,
      sha256: new Uint8Array([8]),
      r2Key: `${org}/files/invoice.pdf`,
      createdBy: userId,
    });
    await tx.insert(reviewEvents).values({
      id: newId("reviewEvent"),
      organizationId: org,
      caseId,
      userId,
      kind: "field.edited",
      path: "vendor",
      before: null,
      after: "acme",
    });
    await tx.insert(caseMentions).values({
      id: newId("mention"),
      organizationId: org,
      caseId,
      groupId,
      messageId: "msg_1",
      by: "agent",
      message: "Please check the vendor",
    });
    await tx.insert(inboxReads).values({
      organizationId: org,
      userId,
      itemKey: `waiting:${caseId}:1`,
    });
    await tx.insert(outbox).values({
      id: newId("outbox"),
      organizationId: org,
      kind: "case.start",
      payload: { caseId },
    });
    const endpointId = newId("webhook");
    await tx.insert(webhookEndpoints).values({
      id: endpointId,
      organizationId: org,
      url: "https://hooks.example.com/preprocess",
      events: ["case.completed"],
      keyVersion: 1,
      signingSecret: new Uint8Array([9]),
      createdBy: userId,
    });
    await tx.insert(webhookDeliveries).values({
      id: newId("delivery"),
      organizationId: org,
      endpointId,
      eventType: "case.completed",
      caseId,
      payload: {},
      status: "pending",
    });
    await tx.insert(organizationGuardrails).values({
      organizationId: org,
      spendingLimitMicroUsd: 1_000_000,
      updatedBy: userId,
    });
    await tx.insert(agentNetworkRules).values({
      organizationId: org,
      agentId,
      rules: { allow: ["erp.example.com"], block: [] },
      updatedBy: userId,
    });
    await tx.insert(guardrailRequests).values({
      id: newId("guardrailRequest"),
      organizationId: org,
      kind: "network",
      agentId,
      change: { kind: "network", hosts: ["bank.example.com"] },
      requestedByType: "person",
      requestedBy: userId,
    });
    await audit(tx, {
      organizationId: org,
      actorType: "person",
      actorId: userId,
      action: "organization.created",
      targetType: "organization",
      targetId: org,
    });
    return {
      org,
      userId,
      groupId,
      developersId,
      agentId,
      deploymentId,
      caseId,
    };
  });

// Every table that holds tenant rows, with its organization column.
export const tenantTables = {
  organization: "id",
  member: "organization_id",
  invitation: "organization_id",
  apikey: "reference_id",
  groups: "organization_id",
  group_members: "organization_id",
  agents: "organization_id",
  agent_grants: "organization_id",
  org_keys: "organization_id",
  secrets: "organization_id",
  cases: "organization_id",
  case_assignees: "organization_id",
  idempotency_keys: "organization_id",
  files: "organization_id",
  review_events: "organization_id",
  case_mentions: "organization_id",
  inbox_reads: "organization_id",
  outbox: "organization_id",
  webhook_endpoints: "organization_id",
  webhook_deliveries: "organization_id",
  audit_events: "organization_id",
  audit_heads: "organization_id",
  deployments: "organization_id",
  deployment_groups: "organization_id",
  secret_grants: "organization_id",
  secret_deliveries: "organization_id",
  mcp_servers: "organization_id",
  mcp_grants: "organization_id",
  mcp_connections: "organization_id",
  mcp_authorizations: "organization_id",
  organization_guardrails: "organization_id",
  agent_network_rules: "organization_id",
  guardrail_requests: "organization_id",
} as const;

export const ident = (name: string) =>
  sql.raw(`"${name.replaceAll('"', '""')}"`);

// Drizzle wraps driver errors ("Failed query: …"); tests match Postgres's own
// message, which it keeps as the cause.
export const failure = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : (error as Error).message;
  }
  return "did not fail";
};
