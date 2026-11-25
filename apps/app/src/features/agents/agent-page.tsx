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
import { Tooltip } from "@preprocess/ui/components/tooltip";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Check, Copy } from "@preprocess/ui/lib/icons";
import { SizeProvider } from "@preprocess/ui/lib/size-context";
import { cn } from "@preprocess/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { PageHeader } from "../../components/page-header";
import {
  SettingsEmpty,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  SettingsStatus,
  formatRelative,
} from "../settings/kit";
import type { AgentAccessLevel } from "./agent-seed";
import { shortDeploymentId } from "./agent-store";
import type { AgentDeploymentSummary, OrgAgentDetail } from "./list-org-agents";
import {
  AgentSectionCrumb,
  AgentSectionNav,
  type AgentSection,
  type SectionAnchor,
} from "./agent-shell";

// ─── Shell ───────────────────────────────────────────────────────────────────

/**
 * An agent's management page (spec 14a): the breadcrumb and actions in the
 * header, the agent's section sidebar beside the content, and the section's
 * settings-width content. A detail page (a deployment, an eval suite or run)
 * keeps its section selected and adds itself to the breadcrumb.
 */
export function AgentPage({
  agent,
  tab,
  detail,
  anchors,
  children,
}: Readonly<{
  agent: OrgAgentDetail;
  tab: AgentSection;
  /** The detail page's own crumb, after its section's. */
  detail?: string;
  /** Jump links under the current section, to element ids on the page. */
  anchors?: readonly SectionAnchor[];
  children: ReactNode;
}>) {
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
            <BreadcrumbItem className="hidden shrink-0 md:inline-flex">
              <BreadcrumbLink render={<Link to="/agents" />}>
                Agents
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:inline-flex">
              /
            </BreadcrumbSeparator>
            <BreadcrumbItem className="min-w-0 shrink">
              <BreadcrumbLink
                className="truncate"
                render={
                  <Link params={{ agentId: agent.id }} to="/agents/$agentId" />
                }
              >
                {agent.name}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>/</BreadcrumbSeparator>
            <AgentSectionCrumb
              agentId={agent.id}
              linked={detail !== undefined}
              section={tab}
            />
            {detail !== undefined ? (
              <>
                <BreadcrumbSeparator>/</BreadcrumbSeparator>
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="truncate">{detail}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : null}
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        <AgentSectionNav agent={agent} anchors={anchors} section={tab} />
        <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-8">
            {children}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────

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

function DeploymentStatus({
  deployment,
}: Readonly<{ deployment: AgentDeploymentSummary }>) {
  switch (deployment.status) {
    case "ready":
      return <SettingsStatus state="success">Ready</SettingsStatus>;
    case "waiting":
      return <SettingsStatus state="warning">Waiting</SettingsStatus>;
    case "failed":
      return <SettingsStatus state="error">Failed</SettingsStatus>;
  }
}

/** The agent's name and production branch, with its ID top right. */
export function AgentOverview({ agent }: Readonly<{ agent: OrgAgentDetail }>) {
  const production = agent.production;
  return (
    <>
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1
            className="truncate text-title tracking-[-0.02em] text-foreground"
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            {agent.name}
          </h1>
          <p className="text-body text-muted-foreground">
            Deploys production from {agent.productionBranch}
          </p>
        </div>
        <AgentIdCopy id={agent.id} />
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
              description={[
                production.branch,
                production.commit?.slice(0, 7),
                production.source === "cli" ? "CLI" : "GitHub",
                formatRelative(production.createdAt),
              ]
                .filter(Boolean)
                .join(" · ")}
              label={
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="text-body text-foreground"
                    style={{ fontVariationSettings: fontWeights.semibold }}
                  >
                    {shortDeploymentId(production.id)}
                  </span>
                  <Badge color="green" size="sm">
                    Production
                  </Badge>
                </span>
              }
              value={
                <span className="truncate text-body text-foreground">
                  {production.model} · {production.reasoning} reasoning
                </span>
              }
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
    </>
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
