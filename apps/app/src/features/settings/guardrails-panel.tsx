"use client";

// Organization guardrails (spec 5): what agents may reach and spend. Only an
// Owner or Admin loosens one, and their change is the approval; anyone else,
// and a deployment that asks for more, files a request that shows here.

import { Link } from "@tanstack/react-router";
import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { Tabs, TabsItem } from "@preprocess/ui/components/tabs";
import { XIcon } from "@preprocess/ui/lib/icons";
import {
  CheckboxGroup,
  CheckboxItem,
} from "@preprocess/ui/components/checkbox-group";
import {
  MODEL_CATALOG,
  MODELS,
  type Model,
  type SandboxSize,
} from "@preprocess/sdk/protocol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  AllCaughtUpArt,
  GoneArt,
  NoResultsArt,
} from "../../components/empty-art";

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
import { SANDBOX_SIZE_OPTIONS } from "./sandbox-sizes";
import { GUARDRAIL_SECTIONS } from "./settings-nav";
import { SettingsStacked } from "./settings-widgets";
import { useCanAdminister } from "./use-role";

export type Rules = { allow: string[]; block: string[] };
export type Change =
  | { kind: "network"; hosts: string[] }
  | { kind: "secret"; secret: string }
  | { kind: "mcp"; server: string }
  | { kind: "spending_limit"; limitUsd: number | null }
  | { kind: "sandbox_size"; size: SandboxSize };
type Status = "pending" | "approved" | "rejected";

const STATUSES: readonly { value: Status; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];
export type GuardrailRequest = {
  id: string;
  agent: string | null;
  deployment: string | null;
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

export const describeChange = (change: Change) => {
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
    case "sandbox_size":
      return `Allow sandboxes up to ${change.size}`;
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

export function GuardrailsPanel({ request }: { request?: string }) {
  return (
    <SettingsStacked>
      <Anchor id="requests">
        <Requests highlight={request} />
      </Anchor>
      <Anchor id="network">
        <Network />
      </Anchor>
      <Anchor id="spending">
        <SpendingLimit />
      </Anchor>
      <Anchor id="sandbox">
        <SandboxSizeLimit />
      </Anchor>
      <Anchor id="models">
        <Models />
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

/** Every guardrail request in the organization, newest first. */
export function useGuardrailRequests() {
  const organizationId = useOrganizationId();
  return useQuery({
    queryKey: ["guardrail-requests", organizationId],
    queryFn: () =>
      orgApi<GuardrailRequest[]>(organizationId, "/guardrail-requests"),
  });
}

/** Approves or rejects a request, then refreshes what the change touches. */
export function useDecideRequest() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  return async (id: string, verdict: "approve" | "reject") => {
    await orgApi(organizationId, `/guardrail-requests/${id}/${verdict}`, {
      method: "POST",
    });
    await Promise.all(
      [
        "guardrail-requests",
        "guardrails",
        "spending",
        "deployments",
        "agent-network",
      ].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key, organizationId] }),
      ),
    );
  };
}

/**
 * Requests as rows, with Approve and Reject for Owners and Admins on the
 * pending ones. The row named by `highlight` (a `?request=` link) is marked
 * and scrolled into view.
 */
export function RequestRows({
  requests,
  highlight,
}: {
  requests: GuardrailRequest[];
  highlight?: string;
}) {
  const organizationId = useOrganizationId();
  const canDecide = useCanAdminister();
  const names = useMemberNames(organizationId);
  const decide = useDecideRequest();
  const [error, setError] = useState<unknown>(null);
  const highlighted = useRef<HTMLDivElement>(null);
  const shown = requests.some((r) => r.id === highlight);
  useEffect(() => {
    if (!shown) return;
    // Sections above may still be loading and push the row down.
    const timer = setTimeout(
      () => highlighted.current?.scrollIntoView({ block: "center" }),
      400,
    );
    return () => clearTimeout(timer);
  }, [shown]);

  return (
    <>
      <SettingsRows>
        {requests.map((request) => (
          <div
            className={request.id === highlight ? "bg-selected" : undefined}
            id={`request-${request.id}`}
            key={request.id}
            ref={request.id === highlight ? highlighted : undefined}
          >
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
              label={describeChange(request.change)}
            >
              {request.status === "pending" && canDecide ? (
                <>
                  <LoadingButton
                    onAction={() => {
                      setError(null);
                      return decide(request.id, "reject");
                    }}
                    onError={setError}
                    variant="secondary"
                  >
                    Reject
                  </LoadingButton>
                  <LoadingButton
                    onAction={() => {
                      setError(null);
                      return decide(request.id, "approve");
                    }}
                    onError={setError}
                  >
                    Approve
                  </LoadingButton>
                </>
              ) : request.status === "pending" ? (
                <Badge color="amber">Waiting for an Owner or Admin</Badge>
              ) : (
                <Badge color={request.status === "approved" ? "green" : "gray"}>
                  {request.status === "approved" ? "Approved" : "Rejected"}
                </Badge>
              )}
            </SettingsRow>
          </div>
        ))}
      </SettingsRows>
      <ErrorLine error={error} fallback="Could not decide the request." />
    </>
  );
}

function Requests({ highlight }: { highlight?: string }) {
  const requests = useGuardrailRequests();
  const rows = requests.data ?? [];
  const linked = rows.find((r) => r.id === highlight);
  const [status, setStatus] = useState<Status>(linked?.status ?? "pending");
  useEffect(() => {
    if (linked) setStatus(linked.status);
  }, [linked]);
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  const shown = rows.filter((r) => r.status === status);

  const statusTabs = (
    <Tabs
      aria-label="Request status"
      onSelect={(index) => setStatus(STATUSES[index]?.value ?? "pending")}
      selectedIndex={Math.max(
        0,
        STATUSES.findIndex((option) => option.value === status),
      )}
    >
      {STATUSES.map((option, index) => (
        <TabsItem
          index={index}
          key={option.value}
          label={`${option.label} ${count(option.value)}`}
        />
      ))}
    </Tabs>
  );

  return (
    <SettingsSection
      actions={<div className="hidden md:block">{statusTabs}</div>}
      description="Asks to loosen a guardrail, from Developers and from deployments that need more than the guardrails allow."
      title={sectionTitle("requests")}
    >
      {/* Narrow screens: the tabs take their own row under the title,
          scrolling sideways when they don't fit. */}
      <ScrollArea
        className="md:hidden"
        orientation="horizontal"
        viewportClassName="scroll-fade-x"
      >
        <div className="w-max">{statusTabs}</div>
      </ScrollArea>
      {requests.isError ? (
        <SettingsError error={requests.error} />
      ) : requests.isPending ? (
        <SettingsSkeletonRows count={2} />
      ) : highlight && !linked ? (
        <SettingsEmpty
          action={
            <Button asChild size="compact" variant="ghost">
              <Link to="/settings/organization/guardrails">
                View all requests
              </Link>
            </Button>
          }
          art={<GoneArt />}
          description="This guardrail request no longer exists."
          title="Request not found"
        />
      ) : shown.length === 0 ? (
        <SettingsEmpty
          art={status === "pending" ? <AllCaughtUpArt /> : <NoResultsArt />}
          description={
            status === "pending"
              ? "All guardrail loosening requests have been decided."
              : `Guardrail requests that are ${status} appear here.`
          }
          title={`No ${status} requests`}
        />
      ) : (
        <RequestRows highlight={highlight} requests={shown} />
      )}
    </SettingsSection>
  );
}

export function ErrorLine({
  error,
  fallback,
}: {
  error: unknown;
  fallback: string;
}) {
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

export function PatternList({
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

function Models() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const canEdit = useCanAdminister();
  const guardrails = useQuery({
    queryKey: ["guardrails", organizationId],
    queryFn: () =>
      orgApi<{ allowedModels: Model[] | null }>(organizationId, "/guardrails"),
  });
  const saved = guardrails.data?.allowedModels ?? MODELS;
  const [draft, setDraft] = useState<readonly Model[]>(MODELS);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setDraft(saved), [saved]);
  const dirty =
    draft.length !== saved.length || draft.some((m) => !saved.includes(m));

  return (
    <SettingsSection
      description="Which models agents may run on, and where their calls go. A deploy, setting, case or eval run that needs another model is refused and names it."
      title={sectionTitle("models")}
    >
      {guardrails.isError ? (
        <SettingsError error={guardrails.error} />
      ) : !guardrails.data ? (
        <SettingsSkeletonRows count={2} />
      ) : (
        <SettingsRows>
          <SettingsRow
            description={
              guardrails.data.allowedModels === null
                ? "Every model, the default"
                : `${saved.length} of ${MODELS.length} models`
            }
            label="Allowed models"
            value={
              <CheckboxGroup
                checkedIndices={
                  new Set(
                    MODELS.flatMap((model, index) =>
                      draft.includes(model) ? [index] : [],
                    ),
                  )
                }
              >
                {MODELS.map((model, index) => (
                  <CheckboxItem
                    aria-disabled={!canEdit}
                    checked={draft.includes(model)}
                    index={index}
                    key={model}
                    label={MODEL_CATALOG[model].label}
                    onToggle={() =>
                      canEdit &&
                      setDraft(
                        draft.includes(model)
                          ? draft.filter((m) => m !== model)
                          : MODELS.filter(
                              (m) => m === model || draft.includes(m),
                            ),
                      )
                    }
                  />
                ))}
              </CheckboxGroup>
            }
          >
            {canEdit ? (
              <LoadingButton
                disabled={!dirty}
                onAction={async () => {
                  setError(null);
                  if (draft.length === 0)
                    throw new Error("Allow at least one model.");
                  await orgApi(organizationId, "/guardrails/allowed-models", {
                    method: "PUT",
                    body: JSON.stringify({
                      models: draft.length === MODELS.length ? null : draft,
                    }),
                  });
                  await queryClient.invalidateQueries({
                    queryKey: ["guardrails", organizationId],
                  });
                }}
                onError={setError}
              >
                Save
              </LoadingButton>
            ) : null}
          </SettingsRow>
          <SettingsRow
            description="Self-hosted serving URLs arrive with self-hosted installs."
            label="Model endpoints"
            value="Hosted service only"
          />
        </SettingsRows>
      )}
      <ErrorLine
        error={error}
        fallback="Could not change the allowed models."
      />
    </SettingsSection>
  );
}

const ANY_SIZE = "any";

function SandboxSizeLimit() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const canEdit = useCanAdminister();
  const guardrails = useQuery({
    queryKey: ["guardrails", organizationId],
    queryFn: () =>
      orgApi<{ sandboxMaxSize: SandboxSize | null }>(
        organizationId,
        "/guardrails",
      ),
  });
  const saved = guardrails.data?.sandboxMaxSize ?? ANY_SIZE;
  const [draft, setDraft] = useState<string>(ANY_SIZE);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setDraft(saved), [saved]);

  return (
    <SettingsSection
      description="The largest sandbox an agent's cases may start. A deployment that asks for a larger one waits for an Owner or Admin, and a running case can't start one."
      title={sectionTitle("sandbox")}
    >
      {guardrails.isError ? (
        <SettingsError error={guardrails.error} />
      ) : !guardrails.data ? (
        <SettingsSkeletonRows count={1} />
      ) : (
        <SettingsRows>
          <SettingsRow
            description={
              saved === ANY_SIZE ? "Every size, the default" : undefined
            }
            label="Largest size"
            value={
              <Select
                disabled={!canEdit}
                onValueChange={(next) => setDraft(next)}
                value={draft}
              >
                <SelectTrigger
                  aria-label="Largest sandbox size"
                  className="w-72"
                />
                <SelectContent>
                  <SelectItem index={0} value={ANY_SIZE}>
                    Any size
                  </SelectItem>
                  {SANDBOX_SIZE_OPTIONS.map((option, index) => (
                    <SelectItem
                      index={index + 1}
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          >
            {canEdit ? (
              <LoadingButton
                disabled={draft === saved}
                onAction={async () => {
                  setError(null);
                  await orgApi(organizationId, "/guardrails/sandbox-size", {
                    method: "PUT",
                    body: JSON.stringify({
                      size: draft === ANY_SIZE ? null : draft,
                    }),
                  });
                  await Promise.all(
                    ["guardrails", "deployments", "guardrail-requests"].map(
                      (key) =>
                        queryClient.invalidateQueries({
                          queryKey: [key, organizationId],
                        }),
                    ),
                  );
                }}
                onError={setError}
              >
                Save
              </LoadingButton>
            ) : null}
          </SettingsRow>
        </SettingsRows>
      )}
      <ErrorLine error={error} fallback="Could not change the largest size." />
    </SettingsSection>
  );
}
