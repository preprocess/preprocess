import type { ProductProperties } from "@preprocess/logs";

import type { FileRoutesById } from "../../routeTree.gen";

export type Surface = ProductProperties<"feature_viewed">["surface"];

// The app's main surfaces by route (PRE-160): opening one sends
// feature_viewed. Routes that only redirect, sign-in and onboarding have
// none. The case room's Review view is its own surface, sent by the room.
const SURFACES: Partial<Record<keyof FileRoutesById, Surface>> = {
  "/inbox": "inbox",
  "/cases/": "cases",
  "/agents/$agentId_/cases/$caseId": "case_room",
  "/agents/": "agents",
  "/agents/$agentId/": "agent_overview",
  "/agents/$agentId_/cases/": "agent_cases",
  "/agents/$agentId/deployments": "agent_deployments",
  "/agents/$agentId/configuration": "agent_configuration",
  "/agents/$agentId/access": "agent_access",
  "/agents/$agentId/evaluations/": "agent_evaluations",
  "/agents/$agentId/evaluations/$suiteId/": "agent_evaluations",
  "/agents/$agentId/evaluations/$suiteId/runs/$runId": "agent_evaluation_run",
  "/agents/$agentId/memories": "agent_memories",
  "/agents/$agentId/observability": "agent_observability",
  "/agents/$agentId/settings": "agent_settings",
  "/agents/$agentId/training/": "agent_training",
  "/agents/$agentId/training/datasets/$datasetId": "agent_dataset",
  "/developers/observability": "observability",
  "/settings/account/": "settings_account",
  "/settings/organization/": "settings_organization",
  "/settings/organization/members": "settings_members",
  "/settings/organization/groups/": "settings_groups",
  "/settings/organization_/groups/$groupId": "settings_groups",
  "/settings/organization/billing": "settings_billing",
  "/settings/organization/models": "settings_models",
  "/settings/organization/defaults": "settings_defaults",
  "/settings/organization/guardrails": "settings_guardrails",
  "/settings/organization/retention": "settings_retention",
  "/settings/organization/audit-logs": "settings_audit_logs",
  "/settings/organization/sso": "settings_sso",
  "/settings/organization/directory-sync": "settings_directory_sync",
  "/settings/organization/license": "settings_license",
  "/settings/organization/api-keys": "developers_api_keys",
  "/settings/organization/github": "developers_github",
  "/settings/organization/integrations": "developers_integrations",
  "/settings/organization/secrets": "developers_secrets",
  "/settings/organization/network": "developers_network",
  "/settings/organization/sandboxes": "developers_sandboxes",
  "/settings/organization/opentelemetry": "developers_opentelemetry",
};

export const surfaceOf = (routeId: string) =>
  SURFACES[routeId as keyof FileRoutesById];
