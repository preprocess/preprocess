"use client";

// An agent's deployments (spec 14a, Ship): every push, newest first. A waiting
// deployment lists what it waits for, and each item that a guardrail request
// can grant shows its request or lets a Developer file one.

import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { useOrganizationId } from "../auth/auth-context";
import { orgApi } from "../auth/client";
import {
  formatRelative,
  SettingsEmpty,
  SettingsError,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  SettingsSkeletonRows,
} from "../settings/kit";
import {
  describeChange,
  ErrorLine,
  useDecideRequest,
  useGuardrailRequests,
  type Change,
  type GuardrailRequest,
} from "../settings/guardrails-panel";
import { useCanAdminister, useCanDeploy } from "../settings/use-role";
import { DeploymentStatus } from "./agent-page";
import { shortDeploymentId } from "./agent-store";
import type { OrgAgentDetail } from "./list-org-agents";

type WaitingFor = {
  secrets?: string[];
  mcp?: string[];
  network?: string[];
  groups?: string[];
};

type Deployment = {
  id: string;
  status: "ready" | "waiting" | "failed";
  environment?: "production" | "preview";
  waitingFor: WaitingFor;
  model: string;
  reasoning: string;
  git: { branch: string | null; commit: string | null };
  source: "cli" | "github";
  warnings: string[];
  createdAt: string;
  promotedAt: string | null;
};

/** One thing a waiting deployment needs, and the request that would grant it. */
type Need = { label: string; change: Change | null };

const needsOf = (waitingFor: WaitingFor): Need[] => [
  ...(waitingFor.network ?? []).map((host) => ({
    label: `Network access to ${host}`,
    change: { kind: "network" as const, hosts: [host] },
  })),
  ...(waitingFor.secrets ?? []).map((secret) => ({
    label: `The secret ${secret}`,
    change: { kind: "secret" as const, secret },
  })),
  ...(waitingFor.mcp ?? []).map((server) => ({
    label: `The MCP server ${server}`,
    change: { kind: "mcp" as const, server },
  })),
  ...(waitingFor.groups ?? []).map((group) => ({
    label: `Access for the group ${group}`,
    change: null,
  })),
];

const grants = (request: GuardrailRequest, change: Change) => {
  const asked = request.change;
  switch (change.kind) {
    case "network":
      return (
        asked.kind === "network" &&
        change.hosts.every((host) => asked.hosts.includes(host))
      );
    case "secret":
      return asked.kind === "secret" && asked.secret === change.secret;
    case "mcp":
      return asked.kind === "mcp" && asked.server === change.server;
    case "spending_limit":
      return false;
  }
};

export function AgentDeployments({ agent }: { agent: OrgAgentDetail }) {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const path = `/agents/${encodeURIComponent(agent.id)}/deployments`;
  const deployments = useQuery({
    queryKey: ["deployments", organizationId, agent.id],
    queryFn: () => orgApi<Deployment[]>(organizationId, path),
  });
  const requests = useGuardrailRequests();
  const decide = useDecideRequest();
  const canDecide = useCanAdminister();
  const canPromote = useCanDeploy();
  const pending = (requests.data ?? []).filter(
    (r) => r.status === "pending" && r.agent === agent.id,
  );

  const promote = async (id: string) => {
    setError(null);
    await orgApi(organizationId, `${path}/${id}/promote`, { method: "POST" });
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["deployments", organizationId, agent.id],
      }),
      router.invalidate(),
    ]);
  };
  const request = async (deployment: Deployment, change: Change) => {
    setError(null);
    await orgApi(organizationId, "/guardrail-requests", {
      method: "POST",
      body: JSON.stringify({
        agent: agent.id,
        change,
        reason: `Deployment ${shortDeploymentId(deployment.id)} waits for it.`,
      }),
    });
    await queryClient.invalidateQueries({
      queryKey: ["guardrail-requests", organizationId],
    });
  };

  const rows = deployments.data ?? [];
  const current = agent.productionDeploymentId;

  return (
    <SettingsSection
      description={`Every push deploys: ${agent.productionBranch} to production, other branches to previews. Promoting an earlier production deployment rolls back to it.${canPromote ? "" : " Owners, Admins and the Developers group can promote."}`}
      title="Deployments"
    >
      {deployments.isError ? (
        <SettingsError error={deployments.error} />
      ) : deployments.isPending ? (
        <SettingsSkeletonRows count={3} />
      ) : rows.length === 0 ? (
        <SettingsEmpty
          description="Run preprocess deploy, or push to a connected repository."
          title="No deployments yet"
        />
      ) : (
        <SettingsRows>
          {rows.map((deployment) => {
            const serving = deployment.id === current;
            const production = deployment.environment === "production";
            const needs =
              deployment.status === "waiting"
                ? needsOf(deployment.waitingFor)
                : [];
            return (
              <div key={deployment.id}>
                <SettingsRow
                  description={[
                    deployment.git.branch,
                    deployment.git.commit?.slice(0, 7),
                    deployment.source === "cli" ? "CLI" : "GitHub",
                    formatRelative(deployment.createdAt),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  label={
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="text-body text-foreground"
                        style={{ fontVariationSettings: fontWeights.medium }}
                      >
                        {shortDeploymentId(deployment.id)}
                      </span>
                      {serving ? (
                        <Badge color="green" size="sm">
                          Production
                        </Badge>
                      ) : production ? null : (
                        <Badge color="gray" size="sm">
                          Preview
                        </Badge>
                      )}
                    </span>
                  }
                  value={
                    <span className="truncate text-body text-foreground">
                      {deployment.model} · {deployment.reasoning} reasoning
                    </span>
                  }
                >
                  {canPromote &&
                  production &&
                  !serving &&
                  deployment.status === "ready" ? (
                    <LoadingButton
                      onAction={() => promote(deployment.id)}
                      onError={setError}
                      variant="secondary"
                    >
                      Promote
                    </LoadingButton>
                  ) : null}
                  <DeploymentStatus deployment={deployment} />
                </SettingsRow>
                {needs.map((need) => {
                  const asked = need.change
                    ? pending.find((r) => grants(r, need.change!))
                    : undefined;
                  return (
                    <SettingsRow
                      className="pl-10"
                      description={
                        asked
                          ? `Requested ${formatRelative(asked.createdAt)}: ${describeChange(asked.change)}`
                          : need.change
                            ? "Waiting for an Owner or Admin to allow it."
                            : "Grant the group access to this agent."
                      }
                      key={need.label}
                      label={need.label}
                    >
                      {asked && canDecide ? (
                        <>
                          <LoadingButton
                            onAction={() => {
                              setError(null);
                              return decide(asked.id, "reject");
                            }}
                            onError={setError}
                            variant="secondary"
                          >
                            Reject
                          </LoadingButton>
                          <LoadingButton
                            onAction={() => {
                              setError(null);
                              return decide(asked.id, "approve");
                            }}
                            onError={setError}
                          >
                            Approve
                          </LoadingButton>
                        </>
                      ) : asked ? (
                        <Button
                          render={
                            <Link
                              hash="requests"
                              params={{ agentId: agent.id }}
                              search={{ request: asked.id }}
                              to="/agents/$agentId/settings"
                            />
                          }
                          size="compact"
                          variant="ghost"
                        >
                          View request
                        </Button>
                      ) : need.change ? (
                        <LoadingButton
                          onAction={() => request(deployment, need.change!)}
                          onError={setError}
                          variant="secondary"
                        >
                          Request
                        </LoadingButton>
                      ) : null}
                    </SettingsRow>
                  );
                })}
              </div>
            );
          })}
        </SettingsRows>
      )}
      <ErrorLine error={error} fallback="Could not do that." />
    </SettingsSection>
  );
}
