import { Badge } from "@preprocess/ui/components/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@preprocess/ui/components/breadcrumb";
import { Button } from "@preprocess/ui/components/button";
import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { Tooltip } from "@preprocess/ui/components/tooltip";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  Brain,
  ChartLine,
  Check,
  Code,
  Copy,
  Gauge,
  Home,
  Pencil,
  Play,
  RotateCcw,
  Rocket,
  Settings,
  ThumbsUp,
  Users,
} from "@preprocess/ui/lib/icons";
import { SizeProvider } from "@preprocess/ui/lib/size-context";
import { cn } from "@preprocess/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { PageHeader } from "../../components/page-header";
import { ViewTabs, type ViewTab } from "../agent-cases/case-room-tabs";
import {
  CASE_STATUSES,
  formatCost,
  type CaseStatus,
} from "../agent-cases/case";
import { CaseStatusIcon } from "../agent-cases/case-status-icon";
import {
  SettingsCard,
  SettingsConfirmDialog,
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsEmpty,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsSection,
  SettingsStatus,
  actionErrorMessage,
  formatRelative,
} from "../settings/kit";
import { MemoryList } from "./agent-knowledge";
import { RunCaseDialog, deploymentTestCommand } from "./deployment-actions";
import { SEED_GROUPS, type AgentAccessLevel } from "./agent-seed";
import {
  DEFAULT_PRODUCTION_BRANCH,
  deploymentEnvironment,
  modelLabel,
  shortDeploymentId,
  type AgentDeployment,
  type ReasoningLevel,
} from "./agent-store";
import type { OrgAgentDetail } from "./list-org-agents";

/** The agent page's tabs. Settings stacks the per-agent layers on
 *  organization settings: sandbox image, secrets, and network. */
export const AGENT_TABS = [
  { id: "", label: "Overview", icon: Home },
  { id: "observability", label: "Observability", icon: Gauge },
  { id: "feedback", label: "Feedback", icon: ThumbsUp },
  { id: "memories", label: "Memories", icon: Brain },
  { id: "evaluations", label: "Evaluations", icon: ChartLine },
  { id: "configuration", label: "Configuration", icon: Code },
  { id: "deployments", label: "Deployments", icon: Rocket },
  { id: "access", label: "Access", icon: Users },
  { id: "settings", label: "Settings", icon: Settings },
] as const satisfies readonly ViewTab<string>[];

export type AgentTab = (typeof AGENT_TABS)[number]["id"];

const countFormat = new Intl.NumberFormat();

// ─── Shell ───────────────────────────────────────────────────────────────────

/**
 * An agent's management page, after Vercel's project pages: the agent and
 * its production deployment in the header, a tab per area, and the tab's
 * settings-width content below.
 */
export function AgentPage({
  agent,
  tab,
  children,
}: Readonly<{ agent: OrgAgentDetail; tab: AgentTab; children: ReactNode }>) {
  const navigate = useNavigate();
  const params = { agentId: agent.id };
  const openTab = (id: AgentTab) => {
    switch (id) {
      case "":
        return void navigate({ to: "/agents/$agentId", params });
      case "deployments":
        return void navigate({ to: "/agents/$agentId/deployments", params });
      case "observability":
        return void navigate({ to: "/agents/$agentId/observability", params });
      case "configuration":
        return void navigate({ to: "/agents/$agentId/configuration", params });
      case "memories":
        return void navigate({ to: "/agents/$agentId/memories", params });
      case "evaluations":
        return void navigate({ to: "/agents/$agentId/evaluations", params });
      case "feedback":
        return void navigate({ to: "/agents/$agentId/feedback", params });
      case "access":
        return void navigate({ to: "/agents/$agentId/access", params });
      case "settings":
        return void navigate({ to: "/agents/$agentId/settings", params });
      default: {
        const _exhaustive: never = id;
        return _exhaustive;
      }
    }
  };

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="agent-page"
    >
      <PageHeader
        trailing={
          <>
            <Button
              render={<Link search={{ agent: [agent.id] }} to="/cases" />}
              type="button"
              variant="secondary"
            >
              View cases
            </Button>
          </>
        }
      >
        <Breadcrumb className="flex min-w-0 items-center">
          <BreadcrumbList className="min-w-0 flex-nowrap">
            <BreadcrumbItem className="shrink-0">
              <BreadcrumbLink render={<Link to="/agents" />}>
                Agents
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>/</BreadcrumbSeparator>
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{agent.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {agent.deploymentId ? (
          <Badge className="shrink-0" size="sm">
            {shortDeploymentId(agent.deploymentId)}
          </Badge>
        ) : null}
      </PageHeader>
      {/* The agent's tabs sit in their own row under the header, like the
          case room's views. */}
      <div className="flex shrink-0 items-center overflow-hidden px-1.5 py-2">
        <ViewTabs
          idPrefix="agent-tabs"
          label="Agent sections"
          onSelect={(id) => openTab(id)}
          selectedId={tab}
          tabs={AGENT_TABS}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-8">
          {children}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
}: Readonly<{
  label: string;
  value: ReactNode;
}>) {
  return (
    <SettingsCard className="flex flex-col gap-1 p-4">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span
        className="text-title text-foreground tabular-nums"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {value}
      </span>
    </SettingsCard>
  );
}

/** One status's count; a zero count dims. */
function CaseStatusTile({
  status,
  count,
}: Readonly<{ status: CaseStatus; count: number }>) {
  return (
    <SettingsCard className="flex flex-col gap-1 p-4">
      <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <CaseStatusIcon status={status} />
        {status}
      </span>
      <span
        className={cn(
          "text-title tabular-nums",
          count === 0 ? "text-muted-foreground" : "text-foreground",
        )}
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {countFormat.format(count)}
      </span>
    </SettingsCard>
  );
}

function DeploymentStatus({
  deployment,
}: Readonly<{ deployment: AgentDeployment }>) {
  return deployment.status === "ready" ? (
    <SettingsStatus state="success">Ready</SettingsStatus>
  ) : (
    <SettingsStatus state="error">Failed</SettingsStatus>
  );
}

const REASONING_LABEL: Record<ReasoningLevel, string> = {
  low: "Low reasoning",
  medium: "Medium reasoning",
  high: "High reasoning",
};

/**
 * A deployment's model and reasoning over who shipped it, when, and how
 * long the build took. When `previous` is given, a change from it is noted.
 */
function DeploymentMeta({
  deployment,
  previous,
}: Readonly<{
  deployment: AgentDeployment;
  previous?: AgentDeployment;
}>) {
  const changes = previous
    ? [
        previous.model !== deployment.model ? "Model changed" : null,
        previous.reasoning !== deployment.reasoning
          ? "Reasoning changed"
          : null,
      ].filter((change): change is string => change !== null)
    : [];
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-center gap-2 text-body text-foreground">
        <span className="truncate">
          {modelLabel(deployment.model)} ·{" "}
          {REASONING_LABEL[deployment.reasoning]}
        </span>
        {changes.map((change) => (
          <Badge className="shrink-0" color="blue" key={change} size="sm">
            {change}
          </Badge>
        ))}
      </span>
      <span className="truncate text-caption text-muted-foreground">
        {deployment.branch} · {deployment.author} ·{" "}
        {formatRelative(deployment.createdAt)} · {deployment.durationSeconds}s
      </span>
    </span>
  );
}

/** Preview builds say so; production builds need no badge until live. */
function EnvironmentBadge({
  branch,
  productionBranch,
}: Readonly<{ branch: string; productionBranch: string }>) {
  if (deploymentEnvironment(branch, productionBranch) === "preview") {
    return (
      <Badge color="gray" size="sm">
        Preview
      </Badge>
    );
  }
  return null;
}

function DeploymentLabel({
  deployment,
  production,
  productionBranch,
}: Readonly<{
  deployment: AgentDeployment;
  production: boolean;
  productionBranch: string;
}>) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="text-body text-foreground"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {shortDeploymentId(deployment.id)}
      </span>
      {production ? (
        <Badge color="green" size="sm">
          Production
        </Badge>
      ) : (
        <EnvironmentBadge
          branch={deployment.branch}
          productionBranch={productionBranch}
        />
      )}
    </span>
  );
}

/** A description is one line on what the agent does. */
const DESCRIPTION_MAX = 120;

function DetailsDialog({
  agent,
  onOpenChange,
  onSave,
}: Readonly<{
  agent: OrgAgentDetail;
  onOpenChange: (open: boolean) => void;
  onSave: (details: { name: string; description: string }) => Promise<unknown>;
}>) {
  const nameRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!nameRef.current?.commit()) throw new AsyncActionAbortError();
    try {
      await onSave({ name: name.trim(), description: description.trim() });
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not save the agent."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell onOpenChange={onOpenChange} open title="Edit details">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        <InlineValidation
          autoFocus
          id="agent-name"
          label="Name"
          onChange={setName}
          ref={nameRef}
          validate={(value) => (value.trim() ? null : "Enter a name.")}
          value={name}
        />
        <InlineValidation
          hint={`One line on what the agent does, up to ${DESCRIPTION_MAX} characters.`}
          id="agent-description"
          label="Description"
          // Typing stops at the limit rather than erroring past it.
          onChange={(next) => setDescription(next.slice(0, DESCRIPTION_MAX))}
          validate={() => null}
          value={description}
        />
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
        <SettingsDialogActions
          onCancel={() => onOpenChange(false)}
          pending={pending}
        >
          <LoadingButton
            onAction={save}
            onStatusChange={(status) => setPending(status === "pending")}
            pendingLabel="Saving…"
            ref={saveRef}
            successLabel="Saved"
            type="submit"
          >
            Save
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}

/** The agent's ID as text sized to fit, with a copy button. */
function AgentIdCopy({ id }: Readonly<{ id: string }>) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground">
      <span>Agent ID</span>
      <span className="text-foreground">{id}</span>
      <Tooltip content={copied ? "Copied" : "Copy ID"} side="bottom">
        <Button
          aria-label="Copy agent ID"
          onClick={() => {
            void navigator.clipboard?.writeText(id).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
          size="icon-compact"
          type="button"
          variant="ghost"
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </Tooltip>
    </span>
  );
}

/**
 * The agent's identity at the top of its overview: its name and
 * description, with its ID and an edit button top right.
 */
function AgentIdentity({
  agent,
  onSaveDetails,
}: Readonly<{
  agent: OrgAgentDetail;
  onSaveDetails: (details: {
    name: string;
    description: string;
  }) => Promise<unknown>;
}>) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex items-center gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1
          className="truncate text-title tracking-[-0.02em] text-foreground"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {agent.name}
        </h1>
        <p className="text-body text-muted-foreground">
          {agent.description || "No description"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <AgentIdCopy id={agent.id} />
        <Tooltip content="Edit details" side="bottom">
          <Button
            aria-label="Edit details"
            onClick={() => setEditing(true)}
            size="icon-compact"
            type="button"
            variant="ghost"
          >
            <Pencil aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>
      {editing ? (
        <DetailsDialog
          agent={agent}
          onOpenChange={setEditing}
          onSave={onSaveDetails}
        />
      ) : null}
    </div>
  );
}

const RECENT_MEMORIES = 5;

export function AgentOverview({
  agent,
  onSaveDetails,
}: Readonly<{
  agent: OrgAgentDetail;
  onSaveDetails: (details: {
    name: string;
    description: string;
  }) => Promise<unknown>;
}>) {
  const { stats } = agent;
  const average =
    stats.total > 0 ? Math.round(stats.costCents / stats.total) : 0;
  const production = agent.deployments.find(
    (item) => item.id === agent.productionId,
  );

  return (
    <>
      <AgentIdentity agent={agent} onSaveDetails={onSaveDetails} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {CASE_STATUSES.map((status) => (
          <CaseStatusTile
            count={stats.byStatus[status]}
            key={status}
            status={status}
          />
        ))}
        <StatTile label="Total cost" value={formatCost(stats.costCents)} />
        <StatTile label="Cost per case" value={formatCost(average)} />
      </div>
      <SettingsSection
        actions={
          <Button
            render={
              <Link
                params={{ agentId: agent.id }}
                to="/agents/$agentId/deployments"
              />
            }
            size="compact"
            type="button"
            variant="ghost"
          >
            All deployments
          </Button>
        }
        title="Production"
      >
        {production ? (
          <SettingsRows>
            <SettingsRow
              description={production.message}
              label={
                <DeploymentLabel
                  deployment={production}
                  production
                  productionBranch={
                    agent.repo?.productionBranch ?? DEFAULT_PRODUCTION_BRANCH
                  }
                />
              }
              value={<DeploymentMeta deployment={production} />}
            >
              <DeploymentStatus deployment={production} />
            </SettingsRow>
          </SettingsRows>
        ) : (
          <SettingsEmpty
            description="Deploy the agent to serve cases."
            title="Not deployed"
          />
        )}
      </SettingsSection>
      <SettingsSection
        actions={
          <Button
            render={
              <Link
                params={{ agentId: agent.id }}
                to="/agents/$agentId/memories"
              />
            }
            size="compact"
            type="button"
            variant="ghost"
          >
            View all
          </Button>
        }
        title="Recent memories"
      >
        <MemoryList memories={agent.memories.slice(0, RECENT_MEMORIES)} />
      </SettingsSection>
    </>
  );
}

// ─── Deployments ─────────────────────────────────────────────────────────────

export function AgentDeployments({
  agent,
  onPromote,
}: Readonly<{
  agent: OrgAgentDetail;
  onPromote: (deploymentId: string) => Promise<unknown>;
}>) {
  const [promoting, setPromoting] = useState<AgentDeployment | null>(null);
  const [running, setRunning] = useState<AgentDeployment | null>(null);
  const productionIndex = agent.deployments.findIndex(
    (item) => item.id === agent.productionId,
  );
  // Newest first, so a lower index is a newer deployment.
  const isRollback = (deployment: AgentDeployment) =>
    agent.deployments.indexOf(deployment) > productionIndex;

  return (
    <SettingsSection
      description={`Every push deploys: ${agent.repo?.productionBranch ?? DEFAULT_PRODUCTION_BRANCH} builds for production, other branches to previews. Promote or roll back to any ready build; it serves production right away.`}
      title="Deployments"
    >
      <SettingsRows>
        {agent.deployments.map((deployment, index) => {
          const production = deployment.id === agent.productionId;
          const canServe = deployment.status === "ready" && !production;
          return (
            <SettingsRow
              description={deployment.message}
              key={deployment.id}
              label={
                <DeploymentLabel
                  deployment={deployment}
                  production={production}
                  productionBranch={
                    agent.repo?.productionBranch ?? DEFAULT_PRODUCTION_BRANCH
                  }
                />
              }
              value={
                <DeploymentMeta
                  deployment={deployment}
                  previous={agent.deployments[index + 1]}
                />
              }
            >
              <DeploymentStatus deployment={deployment} />
              <SettingsRowMenu
                actions={[
                  {
                    label: isRollback(deployment)
                      ? `Roll back to ${shortDeploymentId(deployment.id)}`
                      : `Promote ${shortDeploymentId(deployment.id)}`,
                    icon: isRollback(deployment) ? RotateCcw : Rocket,
                    disabled: !canServe,
                    onSelect: () => setPromoting(deployment),
                  },
                  {
                    label: "Run a case",
                    icon: Play,
                    disabled: deployment.status !== "ready",
                    onSelect: () => setRunning(deployment),
                  },
                  {
                    label: "Copy test command",
                    icon: Copy,
                    disabled: deployment.status !== "ready",
                    onSelect: () =>
                      void navigator.clipboard?.writeText(
                        deploymentTestCommand(deployment, production),
                      ),
                  },
                ]}
                label={`Actions for ${shortDeploymentId(deployment.id)}`}
              />
            </SettingsRow>
          );
        })}
      </SettingsRows>
      {running ? (
        <RunCaseDialog
          deployment={running}
          onOpenChange={(open) => (open ? undefined : setRunning(null))}
          production={running.id === agent.productionId}
        />
      ) : null}
      <SettingsConfirmDialog
        confirmLabel={
          promoting && isRollback(promoting) ? "Roll back" : "Promote"
        }
        description={
          promoting
            ? `${shortDeploymentId(promoting.id)} serves production right away. Runs already underway finish on ${shortDeploymentId(agent.deploymentId)}.`
            : undefined
        }
        onConfirm={() =>
          promoting ? onPromote(promoting.id) : Promise.resolve()
        }
        onOpenChange={(open) => (open ? undefined : setPromoting(null))}
        open={promoting !== null}
        pendingLabel={
          promoting && isRollback(promoting) ? "Rolling back…" : "Promoting…"
        }
        successLabel="Live"
        title={
          promoting
            ? isRollback(promoting)
              ? `Roll back to ${shortDeploymentId(promoting.id)}?`
              : `Promote ${shortDeploymentId(promoting.id)}?`
            : "Promote"
        }
      />
    </SettingsSection>
  );
}

// ─── Access ──────────────────────────────────────────────────────────────────

const ACCESS_OPTIONS = [
  { value: "none", label: "No access" },
  { value: "viewer", label: "Viewer" },
  { value: "operator", label: "Operator" },
] as const;

function levelValue(value: string): AgentAccessLevel | null {
  return value === "viewer" || value === "operator" ? value : null;
}

export const LEVEL_RANK = { none: 0, viewer: 1, operator: 2 } as const;
export type AccessValue = keyof typeof LEVEL_RANK;

export function AccessSelect({
  label,
  value,
  onChange,
}: Readonly<{
  label: string;
  value: AccessValue;
  onChange: (level: AgentAccessLevel | null) => void;
}>) {
  return (
    <SizeProvider size="compact">
      <Select
        onValueChange={(next) => onChange(levelValue(next))}
        value={value}
      >
        <SelectTrigger
          aria-label={label}
          className={cn("w-36", value === "none" && "text-muted-foreground")}
        />
        <SelectContent>
          {ACCESS_OPTIONS.map((option, index) => (
            <SelectItem index={index} key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SizeProvider>
  );
}

export const LEVEL_NAME: Record<AgentAccessLevel, string> = {
  operator: "Operator",
  viewer: "Viewer",
};

/**
 * Who can use the agent: a baseline for everyone in the organization, then
 * groups, each of which can raise its members above that baseline.
 */
export function AgentAccess({
  agent,
  onChange,
  onEveryoneChange,
}: Readonly<{
  agent: OrgAgentDetail;
  onChange: (group: string, level: AgentAccessLevel | null) => Promise<unknown>;
  onEveryoneChange: (level: AgentAccessLevel | null) => Promise<unknown>;
}>) {
  const everyone: AccessValue = agent.everyone ?? "none";
  const levelOf = (group: string): AccessValue =>
    agent.access.find((grant) => grant.group === group)?.level ?? "none";

  return (
    <>
      <SettingsSection
        description="Operators work this agent's cases; viewers can only see them. People without access can't see the agent or its cases."
        title="Everyone"
      >
        <SettingsRows>
          <SettingsRow
            description="The least access anyone in the organization has"
            label="Everyone in the organization"
          >
            <AccessSelect
              label="Everyone's access"
              onChange={(level) => void onEveryoneChange(level)}
              value={everyone}
            />
          </SettingsRow>
        </SettingsRows>
      </SettingsSection>
      <SettingsSection
        description="Groups map to roles from your identity provider. A group can raise its members above everyone's access, never below it."
        title="Groups"
      >
        <SettingsRows>
          {SEED_GROUPS.map((group) => {
            const level = levelOf(group);
            const covered =
              agent.everyone !== null &&
              LEVEL_RANK[level] <= LEVEL_RANK[everyone];
            return (
              <SettingsRow
                description={
                  covered && agent.everyone
                    ? `${LEVEL_NAME[agent.everyone]} through Everyone`
                    : undefined
                }
                key={group}
                label={group}
              >
                <AccessSelect
                  label={`${group} access`}
                  onChange={(next) => void onChange(group, next)}
                  value={level}
                />
              </SettingsRow>
            );
          })}
        </SettingsRows>
      </SettingsSection>
    </>
  );
}
