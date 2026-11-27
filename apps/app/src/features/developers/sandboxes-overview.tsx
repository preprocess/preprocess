import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@preprocess/ui/components/table";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { ChevronRight } from "@preprocess/ui/lib/icons";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { CouldntLoadArt, NothingCreatedArt } from "../../components/empty-art";
import { useOrganizationId } from "../auth/auth-context";
import { ApiError, orgApi } from "../auth/client";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsError,
  SettingsRow,
  SettingsRowSkeleton,
  SettingsRows,
  SettingsSection,
} from "../settings/kit";
import { SettingsStacked } from "../settings/settings-widgets";
import { useCanAdminister, useOwns } from "../settings/use-role";

type Size = "small" | "medium" | "large";
type Preset = "standard" | "node" | "python" | "python-data";

type Environment =
  | null
  | { status: "building" }
  | { status: "ready"; bytes: number; large: boolean }
  | { status: "failed"; deploymentId: string; serving: boolean };

type SandboxAgent = {
  id: string;
  slug: string;
  preset: Preset;
  size: Size;
  packages: number;
  waiting: boolean;
  paused: boolean;
  environment: Environment;
};

type Sandboxes = {
  maxSize: Size | null;
  customEnvironments: boolean;
  sizes: { size: Size; vcpu: number; memoryGib: number; diskGb: number }[];
  agents: SandboxAgent[];
};

const PRESETS: { preset: Preset; name: string; detail: string }[] = [
  {
    preset: "standard",
    name: "Standard",
    detail: "Debian with bash, curl and git",
  },
  { preset: "node", name: "Node", detail: "Node.js 24 and npm" },
  { preset: "python", name: "Python", detail: "Python 3 and pip" },
  {
    preset: "python-data",
    name: "Python data",
    detail:
      "Python with pandas, NumPy, Polars, DuckDB, PyArrow, SciPy, Matplotlib and openpyxl",
  },
];

const presetName = (preset: Preset) =>
  PRESETS.find((p) => p.preset === preset)?.name ?? preset;

const sizeName = (size: Size) => size[0].toUpperCase() + size.slice(1);

const packagesLabel = (n: number) =>
  n === 0 ? "None" : n === 1 ? "1 package" : `${n} packages`;

const layerSize = (bytes: number) =>
  bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(1)} GB`
    : `${Math.round(bytes / 1_000_000)} MB`;

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="hidden font-mono text-caption text-muted-foreground sm:inline">
      {children}
    </code>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return (
    <span
      className="truncate text-body text-foreground"
      style={{ fontVariationSettings: fontWeights.medium }}
    >
      {children}
    </span>
  );
}

function EnvironmentStatus({ agent }: { agent: SandboxAgent }) {
  const env = agent.environment;
  if (!env) return <span className="text-muted-foreground">None</span>;
  if (env.status === "building")
    return (
      <Badge color="blue" size="compact" variant="dot">
        Building…
      </Badge>
    );
  if (env.status === "failed")
    return (
      <span className="flex flex-col items-start gap-1">
        <Badge color="red" size="compact" variant="dot">
          Failed
        </Badge>
        <Link
          className="text-caption text-foreground underline decoration-border underline-offset-2"
          hash={env.deploymentId}
          onClick={(event) => event.stopPropagation()}
          params={{ agentId: agent.slug }}
          to="/agents/$agentId/deployments"
        >
          View build log
        </Link>
      </span>
    );
  return (
    <span className="flex flex-col items-start gap-1">
      <Badge
        color={agent.paused ? "gray" : "green"}
        size="compact"
        variant="dot"
      >
        Ready
      </Badge>
      <span className="text-caption text-muted-foreground">
        {env.large
          ? `${layerSize(env.bytes)} · slower starts`
          : layerSize(env.bytes)}
      </span>
    </span>
  );
}

function caption(agent: SandboxAgent) {
  if (agent.environment?.status === "failed")
    return agent.environment.serving
      ? "Latest deployment failed to build its custom environment. The previous deployment is still serving."
      : "Latest deployment failed to build its custom environment.";
  if (agent.paused)
    return "Custom environments require Team. Remove the setup in code, or upgrade to resume.";
  return null;
}

function AgentName({ agent }: { agent: SandboxAgent }) {
  const reason = caption(agent);
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Strong>{agent.slug}</Strong>
        {agent.paused ? (
          <Badge color="amber" size="compact">
            Paused
          </Badge>
        ) : null}
        {agent.waiting ? (
          <Badge color="amber" size="compact" variant="dot">
            Waiting for approval
          </Badge>
        ) : null}
      </div>
      {reason ? (
        <span className="whitespace-normal text-caption text-muted-foreground">
          {reason}
        </span>
      ) : null}
    </div>
  );
}

function AgentsTable({ agents }: { agents: SandboxAgent[] }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="hidden sm:block">
        <SettingsCard table>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="w-28">Preset</TableHead>
                <TableHead className="w-20">Size</TableHead>
                <TableHead className="w-24">Packages</TableHead>
                <TableHead className="w-44 whitespace-nowrap">
                  Custom environment
                </TableHead>
                <TableHead className="w-8">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent, index) => (
                <TableRow
                  className="cursor-pointer"
                  index={index}
                  key={agent.id}
                  onClick={() =>
                    void navigate({
                      to: "/agents/$agentId",
                      params: { agentId: agent.slug },
                    })
                  }
                >
                  <TableCell className="max-w-0 whitespace-normal">
                    <AgentName agent={agent} />
                  </TableCell>
                  <TableCell>{presetName(agent.preset)}</TableCell>
                  <TableCell>{sizeName(agent.size)}</TableCell>
                  <TableCell>{packagesLabel(agent.packages)}</TableCell>
                  <TableCell>
                    <EnvironmentStatus agent={agent} />
                  </TableCell>
                  <TableCell>
                    <Link
                      params={{ agentId: agent.slug }}
                      to="/agents/$agentId"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 text-muted-foreground"
                      />
                      <span className="sr-only">Open</span>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SettingsCard>
      </div>
      <div className="sm:hidden">
        <SettingsRows>
          {agents.map((agent) => (
            <Link
              className="flex flex-col gap-1.5 px-5 py-3"
              key={agent.id}
              params={{ agentId: agent.slug }}
              to="/agents/$agentId"
            >
              <div className="flex items-start justify-between gap-3">
                <AgentName agent={agent} />
                <ChevronRight
                  aria-hidden="true"
                  className="mt-2.5 size-4 shrink-0 text-muted-foreground"
                />
              </div>
              <div className="text-caption text-muted-foreground">
                {presetName(agent.preset)} · {sizeName(agent.size)} ·{" "}
                {packagesLabel(agent.packages)}
              </div>
              {agent.environment ? (
                <div className="pb-1">
                  <EnvironmentStatus agent={agent} />
                </div>
              ) : null}
            </Link>
          ))}
        </SettingsRows>
      </div>
    </>
  );
}

function AgentsSection({
  agents,
  docsUrl,
}: {
  agents: SandboxAgent[];
  docsUrl: string | null;
}) {
  return (
    <SettingsSection
      description="Each agent declares its sandbox in code. To change one, edit the code and redeploy."
      title="Agents using a sandbox"
    >
      {agents.length ? (
        <AgentsTable agents={agents} />
      ) : (
        <SettingsEmpty
          action={
            docsUrl ? (
              <Button asChild size="sm" variant="secondary">
                <a
                  href={`${docsUrl}/sdk/sandbox`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Read the sandbox docs
                </a>
              </Button>
            ) : undefined
          }
          art={<NothingCreatedArt />}
          description="An agent gets a sandbox when its code declares one."
          title="No agents use a sandbox"
        />
      )}
    </SettingsSection>
  );
}

function PresetsSection({
  customEnvironments,
}: {
  customEnvironments: boolean;
}) {
  const owns = useOwns();
  const custom =
    "A preset plus your own setup steps, built once at deploy and billed as storage.";
  return (
    <SettingsSection
      description="Agents choose a preset and size in code."
      title="Presets"
    >
      <SettingsRows>
        {PRESETS.map((preset) => (
          <SettingsRow
            description={preset.detail}
            key={preset.preset}
            label={
              preset.preset === "standard" ? (
                <span className="flex items-center gap-2">
                  {preset.name}
                  <Badge size="compact">Default</Badge>
                </span>
              ) : (
                preset.name
              )
            }
          >
            <Code>preset: "{preset.preset}"</Code>
          </SettingsRow>
        ))}
        <SettingsRow
          description="Agents can add up to 50 apt, pip and npm packages each. They install when the sandbox starts."
          label="Packages"
        >
          <Code>packages</Code>
        </SettingsRow>
        <SettingsRow
          description={
            customEnvironments ? custom : `${custom} Available on Team.`
          }
          label={
            <span className="flex items-center gap-2">
              Custom environments
              <Badge size="compact">Team</Badge>
            </span>
          }
        >
          {customEnvironments ? (
            <Code>setup</Code>
          ) : owns ? (
            <Button asChild size="compact" variant="secondary">
              <Link to="/settings/organization/billing">See plans</Link>
            </Button>
          ) : null}
        </SettingsRow>
      </SettingsRows>
      <p className="flex items-center gap-2 px-5 text-caption text-muted-foreground">
        Fully custom images
        <Badge size="compact">Coming soon</Badge>
      </p>
    </SettingsSection>
  );
}

function SizesSection({ data }: { data: Sandboxes }) {
  const canAdminister = useCanAdminister();
  const limit = data.maxSize
    ? data.sizes.findIndex((s) => s.size === data.maxSize)
    : -1;
  return (
    <SettingsSection
      actions={
        canAdminister ? (
          <Button asChild size="compact" variant="secondary">
            <Link to="/settings/organization/guardrails">
              Manage in Guardrails
            </Link>
          </Button>
        ) : undefined
      }
      description="Deployments that ask for a larger size wait for approval."
      title="Sizes"
    >
      <SettingsRows>
        <SettingsRow label="Largest size allowed">
          <Strong>{data.maxSize ? sizeName(data.maxSize) : "No limit"}</Strong>
        </SettingsRow>
        {data.sizes.map((size, index) => (
          <SettingsRow
            description={`${size.vcpu} vCPU · ${size.memoryGib} GiB memory · ${size.diskGb} GB disk`}
            key={size.size}
            label={
              <span className="flex items-center gap-2">
                {sizeName(size.size)}
                {limit >= 0 && index === limit ? (
                  <Badge color="green" size="compact" variant="dot">
                    Largest allowed
                  </Badge>
                ) : null}
                {limit >= 0 && index > limit ? (
                  <Badge color="amber" size="compact" variant="dot">
                    Needs approval
                  </Badge>
                ) : null}
              </span>
            }
          >
            <Code>size: "{size.size}"</Code>
          </SettingsRow>
        ))}
      </SettingsRows>
    </SettingsSection>
  );
}

function LoadingSection({ title, rows }: { title: string; rows: number }) {
  return (
    <SettingsSection title={title}>
      <SettingsRows>
        {Array.from({ length: rows }, (_, i) => (
          <SettingsRowSkeleton description={220} key={i} label={120} />
        ))}
      </SettingsRows>
    </SettingsSection>
  );
}

export function SandboxesOverview({ docsUrl }: { docsUrl: string | null }) {
  const organizationId = useOrganizationId();
  const sandboxes = useQuery({
    queryKey: ["sandboxes", organizationId],
    queryFn: () => orgApi<Sandboxes>(organizationId, "/sandboxes"),
  });
  if (sandboxes.error) {
    const error = sandboxes.error;
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    )
      return <SettingsError error={error} />;
    return (
      <SettingsEmpty
        action={
          <Button
            onClick={() => void sandboxes.refetch()}
            size="sm"
            variant="secondary"
          >
            Try again
          </Button>
        }
        art={<CouldntLoadArt />}
        description="Something went wrong loading sandboxes. Try again."
        title="Couldn't load sandboxes"
      />
    );
  }
  if (!sandboxes.data)
    return (
      <SettingsStacked>
        <LoadingSection rows={4} title="Agents using a sandbox" />
        <LoadingSection rows={6} title="Presets" />
        <LoadingSection rows={4} title="Sizes" />
      </SettingsStacked>
    );
  return (
    <SettingsStacked>
      <AgentsSection agents={sandboxes.data.agents} docsUrl={docsUrl} />
      <PresetsSection customEnvironments={sandboxes.data.customEnvironments} />
      <SizesSection data={sandboxes.data} />
    </SettingsStacked>
  );
}
