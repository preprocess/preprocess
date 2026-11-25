"use client";

// Organization guardrails (spec 5): what agents may reach and spend. Only an
// Owner or Admin loosens one, and their change is the approval; anyone else,
// and a deployment that asks for more, files a request that shows here.

import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { TabItem, Tabs, TabsList } from "@preprocess/ui/components/tabs";
import { XIcon } from "@preprocess/ui/lib/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { useOrganizationId } from "../auth/auth-context";
import { orgApi } from "../auth/client";
import {
  actionErrorMessage,
  SettingsTextField,
  formatRelative,
  SettingsEmpty,
  SettingsError,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  SettingsSkeletonRows,
} from "./kit";
import { shortDeploymentId } from "../agents/agent-store";
import { GUARDRAIL_SECTIONS } from "./settings-nav";
import { SettingsStacked } from "./settings-widgets";
import { useCanAdminister } from "./use-role";

type Rules = { allow: string[]; block: string[] };
type Change =
  | { kind: "network"; hosts: string[] }
  | { kind: "secret"; secret: string }
  | { kind: "mcp"; server: string }
  | { kind: "spending_limit"; limitUsd: number | null };
type Status = "pending" | "approved" | "rejected";
type GuardrailRequest = {
  id: string;
  agent: string | null;
  change: Change;
  reason: string | null;
  status: Status;
  requestedBy: { type: string; id: string };
  createdAt: string;
};
type Spending = {
  month: string;
  spentUsd: number;
  limitUsd: number | null;
  reached: boolean;
};

const PATTERN =
  /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const usd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

const describeChange = (change: Change) => {
  switch (change.kind) {
    case "network":
      return `Reach ${change.hosts.join(", ")}`;
    case "secret":
      return `Give its code the secret ${change.secret}`;
    case "mcp":
      return `Use the MCP server ${change.server}`;
    case "spending_limit":
      return change.limitUsd === null
        ? "Remove the spending limit"
        : `Set the spending limit to ${usd(change.limitUsd)}`;
  }
};

const sectionTitle = (id: (typeof GUARDRAIL_SECTIONS)[number]["id"]) =>
  GUARDRAIL_SECTIONS.find((s) => s.id === id)!.label;

function Anchor({
  id,
  children,
}: {
  id: (typeof GUARDRAIL_SECTIONS)[number]["id"];
  children: ReactNode;
}) {
  return (
    <div className="scroll-mt-8" id={id}>
      {children}
    </div>
  );
}

export function GuardrailsPanel() {
  return (
    <SettingsStacked>
      <Anchor id="requests">
        <Requests />
      </Anchor>
      <Anchor id="network">
        <Network />
      </Anchor>
      <Anchor id="spending">
        <SpendingLimit />
      </Anchor>
      <Anchor id="models">
        <SettingsSection
          description="Where agents' model calls go."
          title={sectionTitle("models")}
        >
          <SettingsRows>
            <SettingsRow
              description="Self-hosted serving URLs arrive with self-hosted installs."
              label="Inkling 2 Mini, Inkling 2 Small, Kimi K3.1 Pro"
              value="Hosted service only"
            />
          </SettingsRows>
        </SettingsSection>
      </Anchor>
    </SettingsStacked>
  );
}

function useMemberNames(organizationId: string) {
  const members = useQuery({
    queryKey: ["members", organizationId, "names"],
    queryFn: () =>
      orgApi<{ userId: string; name: string }[]>(organizationId, "/members"),
  });
  return new Map(members.data?.map((m) => [m.userId, m.name]));
}

function Requests() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const canDecide = useCanAdminister();
  const names = useMemberNames(organizationId);
  const [status, setStatus] = useState<Status>("pending");
  const [error, setError] = useState<unknown>(null);
  const requests = useQuery({
    queryKey: ["guardrail-requests", organizationId],
    queryFn: () =>
      orgApi<GuardrailRequest[]>(organizationId, "/guardrail-requests"),
  });
  const refresh = () =>
    Promise.all(
      ["guardrail-requests", "guardrails", "spending"].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key, organizationId] }),
      ),
    );
  const decide = async (id: string, verdict: "approve" | "reject") => {
    setError(null);
    await orgApi(organizationId, `/guardrail-requests/${id}/${verdict}`, {
      method: "POST",
    });
    await refresh();
  };

  const rows = requests.data ?? [];
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  const shown = rows.filter((r) => r.status === status);

  return (
    <SettingsSection
      actions={
        <Tabs
          onValueChange={(value) => setStatus(value as Status)}
          value={status}
        >
          <TabsList aria-label="Request status">
            <TabItem label={`Pending ${count("pending")}`} value="pending" />
            <TabItem label={`Approved ${count("approved")}`} value="approved" />
            <TabItem label={`Rejected ${count("rejected")}`} value="rejected" />
          </TabsList>
        </Tabs>
      }
      description="Asks to loosen a guardrail, from Developers and from deployments that need more than the guardrails allow."
      title={sectionTitle("requests")}
    >
      {requests.isError ? (
        <SettingsError error={requests.error} />
      ) : requests.isPending ? (
        <SettingsSkeletonRows count={2} />
      ) : shown.length === 0 ? (
        <SettingsEmpty
          description={
            status === "pending"
              ? "Nobody is waiting on a guardrail."
              : `No ${status} requests yet.`
          }
          title={`No ${status} requests`}
        />
      ) : (
        <SettingsRows>
          {shown.map((request) => (
            <SettingsRow
              description={[
                request.agent ? `Agent ${request.agent}` : "All agents",
                `asked by ${
                  request.requestedBy.type === "person"
                    ? (names.get(request.requestedBy.id) ?? "a member")
                    : request.requestedBy.type === "deployment"
                      ? `deployment ${shortDeploymentId(request.requestedBy.id)}`
                      : "an API key"
                }`,
                formatRelative(request.createdAt),
                request.reason ? `“${request.reason}”` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              key={request.id}
              label={describeChange(request.change)}
            >
              {request.status === "pending" && canDecide ? (
                <>
                  <LoadingButton
                    onAction={() => decide(request.id, "reject")}
                    onError={setError}
                    variant="secondary"
                  >
                    Reject
                  </LoadingButton>
                  <LoadingButton
                    onAction={() => decide(request.id, "approve")}
                    onError={setError}
                  >
                    Approve
                  </LoadingButton>
                </>
              ) : request.status !== "pending" ? (
                <Badge color={request.status === "approved" ? "green" : "gray"}>
                  {request.status === "approved" ? "Approved" : "Rejected"}
                </Badge>
              ) : null}
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      <ErrorLine error={error} fallback="Could not decide the request." />
    </SettingsSection>
  );
}

function ErrorLine({ error, fallback }: { error: unknown; fallback: string }) {
  return error ? (
    <p className="pl-1 text-caption text-destructive" role="alert">
      {actionErrorMessage(error, fallback)}
    </p>
  ) : null;
}

function Network() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const canEdit = useCanAdminister();
  const guardrails = useQuery({
    queryKey: ["guardrails", organizationId],
    queryFn: () => orgApi<{ network: Rules }>(organizationId, "/guardrails"),
  });
  const [draft, setDraft] = useState<Rules | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (guardrails.data) setDraft(guardrails.data.network);
  }, [guardrails.data]);

  const saved = guardrails.data?.network;
  const dirty =
    draft && saved && JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <SettingsSection
      actions={
        canEdit ? (
          <LoadingButton
            disabled={!dirty}
            onAction={async () => {
              setError(null);
              await orgApi(organizationId, "/guardrails/network", {
                method: "PUT",
                body: JSON.stringify(draft),
              });
              await queryClient.invalidateQueries({
                queryKey: ["guardrails", organizationId],
              });
            }}
            onError={setError}
          >
            Save
          </LoadingButton>
        ) : null
      }
      description="Hosts agent code may reach. A host passes when no block pattern matches it and the allow list is empty or one of its patterns matches. Agents can only narrow these."
      title={sectionTitle("network")}
    >
      {guardrails.isError ? (
        <SettingsError error={guardrails.error} />
      ) : !draft ? (
        <SettingsSkeletonRows count={2} />
      ) : (
        <SettingsRows>
          <PatternList
            disabled={!canEdit}
            empty="Every host"
            label="Allow"
            onChange={(allow) => setDraft({ ...draft, allow })}
            patterns={draft.allow}
          />
          <PatternList
            disabled={!canEdit}
            empty="No host"
            label="Block"
            onChange={(block) => setDraft({ ...draft, block })}
            patterns={draft.block}
          />
        </SettingsRows>
      )}
      <ErrorLine error={error} fallback="Could not save the network rules." />
    </SettingsSection>
  );
}

function PatternList({
  label,
  empty,
  patterns,
  disabled,
  onChange,
}: {
  label: string;
  empty: string;
  patterns: string[];
  disabled: boolean;
  onChange: (patterns: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const add = () => {
    const pattern = text.trim().toLowerCase();
    if (!PATTERN.test(pattern)) return setInvalid(true);
    if (!patterns.includes(pattern)) onChange([...patterns, pattern]);
    setText("");
  };
  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-body text-foreground">{label}</span>
        {patterns.length === 0 ? (
          <span className="text-caption text-muted-foreground">{empty}</span>
        ) : null}
      </div>
      {patterns.length ? (
        <ul className="flex flex-wrap gap-2">
          {patterns.map((pattern) => (
            <li key={pattern}>
              <Badge color="gray">
                <span className="font-mono">{pattern}</span>
                {disabled ? null : (
                  <button
                    aria-label={`Remove ${pattern}`}
                    className="ml-1 inline-flex text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      onChange(patterns.filter((p) => p !== pattern))
                    }
                    type="button"
                  >
                    <XIcon size={12} />
                  </button>
                )}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {disabled ? null : (
        <form
          className="flex items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <div className="flex flex-1 flex-col gap-1">
            <SettingsTextField
              aria-invalid={invalid}
              aria-label={`${label} a host`}
              onChange={(event) => {
                setInvalid(false);
                setText(event.target.value);
              }}
              placeholder="api.example.com or *.example.com"
              value={text}
            />
            {invalid ? (
              <span className="pl-1 text-caption text-destructive">
                Use a host like api.example.com or *.example.com.
              </span>
            ) : null}
          </div>
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
      )}
    </div>
  );
}

function SpendingLimit() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const canEdit = useCanAdminister();
  const spending = useQuery({
    queryKey: ["spending", organizationId],
    queryFn: () => orgApi<Spending>(organizationId, "/spending"),
  });
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setText(spending.data?.limitUsd?.toString() ?? "");
  }, [spending.data]);

  const save = async (limitUsd: number | null) => {
    setError(null);
    if (limitUsd !== null && !(limitUsd >= 0))
      throw new Error("Enter an amount in US dollars.");
    await orgApi(organizationId, "/spending/limit", {
      method: "PUT",
      body: JSON.stringify({ limitUsd }),
    });
    await queryClient.invalidateQueries({
      queryKey: ["spending", organizationId],
    });
  };
  const data = spending.data;

  return (
    <SettingsSection
      description="New cases, reruns and OCR stop for the rest of the UTC month once spend reaches the limit. Every deployment counts, previews and evals included."
      title={sectionTitle("spending")}
    >
      {spending.isError ? (
        <SettingsError error={spending.error} />
      ) : !data ? (
        <SettingsSkeletonRows count={2} />
      ) : (
        <SettingsRows>
          <SettingsRow
            description={`Month ${data.month}`}
            label="Spent this month"
            value={
              <span className="flex items-center gap-2">
                {data.limitUsd === null
                  ? usd(data.spentUsd)
                  : `${usd(data.spentUsd)} of ${usd(data.limitUsd)}`}
                {data.reached ? <Badge color="red">Limit reached</Badge> : null}
              </span>
            }
          />
          <SettingsRow
            description={
              data.limitUsd === null ? "No limit, the default" : undefined
            }
            label="Monthly limit"
            value={
              <SettingsTextField
                aria-label="Monthly limit in US dollars"
                className="w-40"
                disabled={!canEdit}
                inputMode="decimal"
                onChange={(event) => setText(event.target.value)}
                placeholder="No limit"
                value={text}
              />
            }
          >
            {canEdit ? (
              <>
                {data.limitUsd !== null ? (
                  <LoadingButton
                    onAction={() => save(null)}
                    onError={setError}
                    variant="secondary"
                  >
                    Remove limit
                  </LoadingButton>
                ) : null}
                <LoadingButton
                  disabled={
                    text.trim() === "" || Number(text) === data.limitUsd
                  }
                  onAction={() => save(Number(text))}
                  onError={setError}
                >
                  Save
                </LoadingButton>
              </>
            ) : null}
          </SettingsRow>
        </SettingsRows>
      )}
      <ErrorLine error={error} fallback="Could not change the limit." />
    </SettingsSection>
  );
}
