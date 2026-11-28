"use client";

// An agent's settings (spec 5): each setting's effective value and where it
// comes from, with dashboard overrides that last until the next promotion, and
// the agent's own network rules, which only narrow the organization's.

import { Button } from "@preprocess/ui/components/button";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AllCaughtUpArt, GoneArt } from "../../components/empty-art";

import { useOrganizationId } from "../auth/auth-context";
import { orgApi } from "../auth/client";
import { FIELDS, type Field } from "../settings/defaults-panel";
import {
  ErrorLine,
  PatternList,
  RequestRows,
  useGuardrailRequests,
  type Rules,
} from "../settings/guardrails-panel";
import {
  SettingsEmpty,
  SettingsError,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  SettingsSkeletonRows,
  SettingsTextField,
} from "../settings/kit";
import { SANDBOX_SIZE_OPTIONS } from "../settings/sandbox-sizes";
import { SettingsStacked } from "../settings/settings-widgets";
import { useCanAdminister } from "../settings/use-role";
import type { SectionAnchor } from "./agent-shell";

type Scalar = string | number | boolean;

type Setting = {
  key: string;
  value: Scalar | null;
  source: "override" | "code" | "organization" | "default";
  override: Scalar | null;
};

type AgentSettingsBody = { settings: Setting[]; warnings: string[] };

type AgentRules = {
  organization: Rules;
  agent: Rules | null;
  effective: Rules;
};

export const AGENT_SETTINGS_ANCHORS: readonly SectionAnchor[] = [
  { id: "effective", label: "Effective settings" },
  { id: "network", label: "Network" },
  { id: "requests", label: "Guardrail requests" },
];

const SOURCE = {
  override: "Dashboard override, until the next promotion",
  code: "Set in code",
  organization: "Organization default",
  default: "Platform default",
} as const;

const text = (value: Scalar | null) => value?.toString() ?? "";

// Listed only for an agent whose code asks for a sandbox; never an
// organization default. The size is set in code only, so it is read-only.
const AGENT_FIELDS: readonly Field<string>[] = [
  ...FIELDS,
  {
    key: "sandbox.size",
    label: "Sandbox size",
    description: "The machine each case's sandbox runs on",
    kind: "choice",
    options: SANDBOX_SIZE_OPTIONS,
  },
];

const parse = (field: Field<string> | undefined, value: string): Scalar => {
  if (field?.kind === "number") return Number(value);
  if (value === "true" || value === "false") return value === "true";
  return value;
};

export function AgentSettings({
  agentSlug,
  request,
}: {
  agentSlug: string;
  request?: string;
}) {
  return (
    <SettingsStacked>
      <div className="scroll-mt-8" id="effective">
        <EffectiveSettings agentSlug={agentSlug} />
      </div>
      <div className="scroll-mt-8" id="network">
        <AgentNetwork agentSlug={agentSlug} />
      </div>
      <div className="scroll-mt-8" id="requests">
        <AgentRequests agentSlug={agentSlug} highlight={request} />
      </div>
    </SettingsStacked>
  );
}

// This agent's pending asks to reach hosts, receive secrets or use MCP
// servers, and the linked one whatever its status.
function AgentRequests({
  agentSlug,
  highlight,
}: {
  agentSlug: string;
  highlight?: string;
}) {
  const requests = useGuardrailRequests();
  const shown = (requests.data ?? []).filter(
    (r) =>
      r.agent === agentSlug && (r.status === "pending" || r.id === highlight),
  );
  return (
    <SettingsSection
      description="This agent's asks to reach a host, receive a secret or use an MCP server. Owners and Admins decide them here or in Organization settings → Guardrails."
      title="Guardrail requests"
    >
      {requests.isError ? (
        <SettingsError error={requests.error} />
      ) : requests.isPending ? (
        <SettingsSkeletonRows count={1} />
      ) : highlight && !shown.some((r) => r.id === highlight) ? (
        <SettingsEmpty
          action={
            <Button asChild size="compact" variant="ghost">
              <Link
                params={{ agentId: agentSlug }}
                to="/agents/$agentId/settings"
              >
                Back to agent settings
              </Link>
            </Button>
          }
          art={<GoneArt />}
          description="This guardrail request no longer exists."
          title="Request not found"
        />
      ) : shown.length === 0 ? (
        <SettingsEmpty
          art={<AllCaughtUpArt />}
          description="This agent has no deployments waiting on a guardrail decision."
          title="No pending requests"
        />
      ) : (
        <RequestRows highlight={highlight} requests={shown} />
      )}
    </SettingsSection>
  );
}

function EffectiveSettings({ agentSlug }: { agentSlug: string }) {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const path = `/agents/${encodeURIComponent(agentSlug)}/settings`;
  const queryKey = ["agent-settings", organizationId, agentSlug];
  const settings = useQuery({
    queryKey,
    queryFn: () => orgApi<AgentSettingsBody>(organizationId, path),
  });
  const [error, setError] = useState<unknown>(null);

  const write = async (key: string, value: Scalar | null) => {
    setError(null);
    const body = await orgApi<AgentSettingsBody>(
      organizationId,
      `${path}/${encodeURIComponent(key)}`,
      value === null
        ? { method: "DELETE" }
        : { method: "PUT", body: JSON.stringify({ value }) },
    );
    queryClient.setQueryData(queryKey, body);
  };

  return (
    <SettingsSection
      description="What this agent runs with and where each value comes from. Code wins over the organization's defaults; an override here wins over both until the next deployment is promoted."
      title="Effective settings"
    >
      {settings.isError ? (
        <SettingsError error={settings.error} />
      ) : !settings.data ? (
        <SettingsSkeletonRows count={FIELDS.length} />
      ) : (
        <SettingsRows>
          {settings.data.settings.map((setting) => (
            <SettingRow
              key={setting.key}
              onClear={() => write(setting.key, null)}
              onError={setError}
              onOverride={(value) => write(setting.key, value)}
              setting={setting}
            />
          ))}
        </SettingsRows>
      )}
      {settings.data?.warnings.map((warning) => (
        <p className="pl-1 text-caption text-muted-foreground" key={warning}>
          {warning}
        </p>
      ))}
      <ErrorLine error={error} fallback="Could not change the setting." />
    </SettingsSection>
  );
}

function SettingRow({
  setting,
  onOverride,
  onClear,
  onError,
}: {
  setting: Setting;
  onOverride: (value: Scalar) => Promise<void>;
  onClear: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const field = AGENT_FIELDS.find((f) => f.key === setting.key);
  const [draft, setDraft] = useState(text(setting.value));
  useEffect(() => setDraft(text(setting.value)), [setting.value]);
  const label = field?.label ?? setting.key;
  const changed = draft !== "" && draft !== text(setting.value);

  if (setting.key === "sandbox.size")
    return (
      <SettingsRow
        description={SOURCE[setting.source]}
        label={label}
        value={
          SANDBOX_SIZE_OPTIONS.find((option) => option.value === setting.value)
            ?.label ?? text(setting.value)
        }
      />
    );

  return (
    <SettingsRow
      description={SOURCE[setting.source]}
      label={label}
      value={
        field?.kind === "choice" ? (
          <Select onValueChange={(next) => setDraft(next)} value={draft}>
            <SelectTrigger aria-label={label} className="w-52" />
            <SelectContent>
              {field.options.map((option, index) => (
                <SelectItem
                  index={index}
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <SettingsTextField
            aria-label={label}
            className="w-52"
            inputMode={field?.kind === "number" ? "numeric" : undefined}
            onChange={(event) => setDraft(event.target.value.trim())}
            placeholder="Not set"
            value={draft}
          />
        )
      }
    >
      {setting.source === "override" ? (
        <LoadingButton onAction={onClear} onError={onError} variant="secondary">
          Clear override
        </LoadingButton>
      ) : null}
      <LoadingButton
        disabled={!changed}
        onAction={async () => {
          if (field?.kind === "number" && !/^\d+$/.test(draft))
            throw new Error(`${label} must be a whole number.`);
          await onOverride(parse(field, draft));
        }}
        onError={onError}
      >
        Override
      </LoadingButton>
    </SettingsRow>
  );
}

function AgentNetwork({ agentSlug }: { agentSlug: string }) {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const canEdit = useCanAdminister();
  const path = `/agents/${encodeURIComponent(agentSlug)}/network`;
  const queryKey = ["agent-network", organizationId, agentSlug];
  const network = useQuery({
    queryKey,
    queryFn: () => orgApi<AgentRules>(organizationId, path),
  });
  const [draft, setDraft] = useState<Rules | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (network.data) setDraft(network.data.agent ?? { allow: [], block: [] });
  }, [network.data]);

  const data = network.data;
  const dirty =
    draft &&
    data &&
    JSON.stringify(draft) !==
      JSON.stringify(data.agent ?? { allow: [], block: [] });
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  return (
    <SettingsSection
      actions={
        canEdit ? (
          <>
            {data?.agent ? (
              <LoadingButton
                onAction={async () => {
                  setError(null);
                  await orgApi(organizationId, path, { method: "DELETE" });
                  await refresh();
                }}
                onError={setError}
                variant="secondary"
              >
                Use organization rules
              </LoadingButton>
            ) : null}
            <LoadingButton
              disabled={!dirty}
              onAction={async () => {
                setError(null);
                await orgApi(organizationId, path, {
                  method: "PUT",
                  body: JSON.stringify(draft),
                });
                await refresh();
              }}
              onError={setError}
            >
              Save
            </LoadingButton>
          </>
        ) : null
      }
      description={
        <>
          Hosts this agent's code may reach. Its own rules only narrow the
          organization's{" "}
          <Link
            className="underline underline-offset-2"
            hash="network"
            to="/settings/organization/guardrails"
          >
            network guardrail
          </Link>
          ; to reach more, ask an Owner or Admin there.
        </>
      }
      title="Network"
    >
      {network.isError ? (
        <SettingsError error={network.error} />
      ) : !data || !draft ? (
        <SettingsSkeletonRows count={3} />
      ) : (
        <SettingsRows>
          <SettingsRow
            description={rulesSummary(data.organization)}
            label="Organization"
          />
          <PatternList
            disabled={!canEdit}
            empty="Whatever the organization allows"
            label="This agent allows"
            onChange={(allow) => setDraft({ ...draft, allow })}
            patterns={draft.allow}
          />
          <PatternList
            disabled={!canEdit}
            empty="Nothing beyond the organization's blocks"
            label="This agent blocks"
            onChange={(block) => setDraft({ ...draft, block })}
            patterns={draft.block}
          />
          <SettingsRow
            description={rulesSummary(data.effective)}
            label="In effect"
          />
        </SettingsRows>
      )}
      <ErrorLine error={error} fallback="Could not save the network rules." />
    </SettingsSection>
  );
}

const rulesSummary = (rules: Rules) =>
  [
    rules.allow.length
      ? `Allows ${rules.allow.join(", ")}`
      : "Allows every host",
    rules.block.length ? `blocks ${rules.block.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");
