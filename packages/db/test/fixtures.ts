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
  ssoProvider,
} from "../src/schema/auth.ts";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "../src/schema/access.ts";
import {
  caseAssignees,
  caseApprovals,
  caseMentions,
  caseSearch,
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
  sandboxLayers,
  secretGrants,
} from "../src/schema/deployments.ts";
import {
  agentNetworkRules,
  guardrailRequests,
  organizationGuardrails,
} from "../src/schema/guardrails.ts";
import {
  agentOverrides,
  organizationDefaults,
} from "../src/schema/settings.ts";
import { logSummaries } from "../src/schema/logs.ts";
import { agentMemories } from "../src/schema/memories.ts";
import { datasets } from "../src/schema/datasets.ts";
import {
  autoReloadStates,
  sandboxIntervals,
  demotedSeats,
  planChanges,
  seatActivity,
  usageRecords,
  usageReports,
} from "../src/schema/billing.ts";
import {
  evalResults,
  evalRuns,
  evalSuiteCases,
  evalSuites,
} from "../src/schema/evals.ts";
import { otelExports } from "../src/schema/otel.ts";
import {
  organizationRetention,
  retentionSweeps,
} from "../src/schema/retention.ts";
import { webhookDeliveries, webhookEndpoints } from "../src/schema/webhooks.ts";
import {
  mcpAuthorizations,
  mcpConnections,
  mcpGrants,
  mcpServers,
} from "../src/schema/mcp.ts";
import {
  githubBuilds,
  githubInstallations,
  githubLinks,
  githubRepositories,
} from "../src/schema/github.ts";
import { modelEndpoints } from "../src/schema/models.ts";
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
    await tx.insert(modelEndpoints).values({
      id: newId("modelEndpoint"),
      organizationId: org,
      model: "kimi-k3.1-pro",
      kind: "override",
      url: "https://models.example.com",
      providerModel: "kimi",
      keyVersion: 1,
      keyCiphertext: new Uint8Array([7, 7, 7]),
      createdBy: userId,
    });
    const deploymentId = newId("deployment");
    await tx.insert(deployments).values({
      id: deploymentId,
      organizationId: org,
      agentId,
      environment: "production",
      status: "ready",
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
    const installationId = newId("githubInstallation");
    await tx.insert(githubInstallations).values({
      id: installationId,
      organizationId: org,
      installationId: Math.floor(Math.random() * 2 ** 40),
      accountLogin: name.toLowerCase(),
      accountType: "Organization",
      createdBy: userId,
    });
    const repositoryId = newId("githubRepository");
    await tx.insert(githubRepositories).values({
      id: repositoryId,
      organizationId: org,
      installationId,
      repositoryId: Math.floor(Math.random() * 2 ** 40),
      fullName: `${name.toLowerCase()}/agents`,
      private: true,
    });
    const linkId = newId("githubLink");
    await tx.insert(githubLinks).values({
      id: linkId,
      organizationId: org,
      repositoryId,
      agentSlug: "stock",
      createdBy: userId,
    });
    await tx.insert(githubBuilds).values({
      id: newId("githubBuild"),
      organizationId: org,
      linkId,
      agentSlug: "stock",
      branch: "main",
      commit: "abc1234",
      status: "succeeded",
      deploymentId,
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
    await tx.insert(caseSearch).values({
      organizationId: org,
      caseId,
      agentId,
      environment: "production",
      input: "Invoice from Acme",
      inputHash: "00",
      answers: { vendor: "acme" },
      changed: ["vendor"],
      completedAt: now,
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
    await tx.insert(caseApprovals).values({
      id: `apr_${crypto.randomUUID()}`,
      organizationId: org,
      caseId,
      level: "tool",
      target: "pay_invoice",
      groupId,
      status: "pending",
      payload: { amount: 120 },
      reason: "Payments need a check",
      requestedAt: new Date(),
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
    await tx.insert(organizationDefaults).values({
      organizationId: org,
      values: { reasoning: "high" },
      updatedBy: userId,
    });
    await tx.insert(agentOverrides).values({
      organizationId: org,
      agentId,
      values: { model: "kimi-k3.1-pro" },
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
    await tx.insert(logSummaries).values({
      organizationId: org,
      subjectKind: "case",
      subjectId: caseId,
      events: 1,
      firstAt: new Date(),
      lastAt: new Date(),
    });
    await tx.insert(organizationRetention).values({
      organizationId: org,
      runCaptureDays: 30,
      updatedBy: userId,
    });
    await tx.insert(retentionSweeps).values({
      id: newId("retentionSweep"),
      organizationId: org,
      kind: "runCapture",
      days: 30,
      cutoff: new Date(),
      counts: { cases: 1 },
    });
    await tx.insert(otelExports).values({
      organizationId: org,
      endpoint: "https://otel.example.com",
      keyVersion: 1,
      headersCiphertext: new Uint8Array([1]),
      updatedBy: userId,
    });
    const suiteId = newId("evalSuite");
    const runId = newId("evalRun");
    await tx.insert(evalSuites).values({
      id: suiteId,
      organizationId: org,
      agentId,
      name: "Completed cases",
      kind: "automatic",
      cap: 100,
      createdBy: userId,
    });
    await tx.insert(evalSuiteCases).values({
      organizationId: org,
      suiteId,
      caseId,
      input: { text: "hello" },
      captureKey: "run.json",
    });
    await tx.insert(evalRuns).values({
      id: runId,
      organizationId: org,
      suiteId,
      deploymentId,
      model: "stub",
      trigger: "manual",
      status: "running",
      createdBy: userId,
    });
    await tx.insert(evalResults).values({
      organizationId: org,
      runId,
      caseId,
      status: "running",
    });
    await tx.insert(agentMemories).values({
      id: newId("memory"),
      organizationId: org,
      agentId,
      caseId,
      text: "Order forms put the term dates on page one.",
      status: "accepted",
    });
    await tx.insert(ssoProvider).values({
      id: newId("ssoProvider"),
      issuer: "https://idp.example",
      providerId: `sso-${org}`,
      organizationId: org,
      domain: `${org}.example`,
      domainVerified: true,
    });
    await tx.insert(datasets).values({
      id: newId("dataset"),
      organizationId: org,
      agentId,
      name: "Corrected order forms",
      query: { outcome: "corrected" },
      createdBy: "usr_seed",
      updatedBy: "usr_seed",
    });
    await tx.insert(usageRecords).values({
      id: newId("usageRecord"),
      organizationId: org,
      feature: "cases",
      quantity: 1,
      caseId,
    });
    await tx.insert(usageReports).values({
      id: newId("usageReport"),
      organizationId: org,
      feature: "cases",
      seq: 1,
      quantity: 1,
      remainder: 0,
    });
    await tx.insert(seatActivity).values({
      organizationId: org,
      userId,
      month: "2026-11-01",
      role: "operator",
    });
    await tx.insert(planChanges).values({
      organizationId: org,
      plan: "free",
      requestedBy: userId,
    });
    await tx.insert(autoReloadStates).values({
      organizationId: org,
      failedAt: new Date("2026-11-26T03:00:00Z"),
      failedReason: "card_declined",
    });
    await tx.insert(demotedSeats).values({
      organizationId: org,
      userId,
      groupId: `group-${org}`,
    });
    await tx.insert(sandboxIntervals).values({
      id: newId("sandboxInterval"),
      organizationId: org,
      sandboxId: `sandbox-${org}`,
      seq: 1,
      agent: agentId,
      caseId,
      kind: "case",
      size: "small",
      startedAt: new Date("2026-11-26T03:00:00Z"),
      lastSeenAt: new Date("2026-11-26T03:00:30Z"),
    });
    await tx.insert(sandboxLayers).values({
      organizationId: org,
      key: `org/${org}/layers/${"0".repeat(64)}`,
      image: "preset@sha256:0",
      bytes: 1,
      unpackedBytes: 1,
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
  sso_provider: "organization_id",
  groups: "organization_id",
  group_members: "organization_id",
  agents: "organization_id",
  agent_grants: "organization_id",
  org_keys: "organization_id",
  secrets: "organization_id",
  model_endpoints: "organization_id",
  cases: "organization_id",
  case_assignees: "organization_id",
  idempotency_keys: "organization_id",
  files: "organization_id",
  review_events: "organization_id",
  case_search: "organization_id",
  case_mentions: "organization_id",
  case_approvals: "organization_id",
  agent_memories: "organization_id",
  datasets: "organization_id",
  usage_records: "organization_id",
  usage_reports: "organization_id",
  seat_activity: "organization_id",
  plan_changes: "organization_id",
  demoted_seats: "organization_id",
  auto_reload_states: "organization_id",
  sandbox_intervals: "organization_id",
  sandbox_layers: "organization_id",
  inbox_reads: "organization_id",
  outbox: "organization_id",
  webhook_endpoints: "organization_id",
  webhook_deliveries: "organization_id",
  audit_events: "organization_id",
  audit_heads: "organization_id",
  deployments: "organization_id",
  deployment_groups: "organization_id",
  secret_grants: "organization_id",
  mcp_servers: "organization_id",
  mcp_grants: "organization_id",
  mcp_connections: "organization_id",
  mcp_authorizations: "organization_id",
  github_installations: "organization_id",
  github_repositories: "organization_id",
  github_links: "organization_id",
  github_builds: "organization_id",
  organization_guardrails: "organization_id",
  agent_network_rules: "organization_id",
  guardrail_requests: "organization_id",
  organization_defaults: "organization_id",
  agent_overrides: "organization_id",
  log_summaries: "organization_id",
  organization_retention: "organization_id",
  retention_sweeps: "organization_id",
  otel_exports: "organization_id",
  eval_suites: "organization_id",
  eval_suite_cases: "organization_id",
  eval_runs: "organization_id",
  eval_results: "organization_id",
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
