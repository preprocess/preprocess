import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { TabItem, Tabs, TabsList } from "@preprocess/ui/components/tabs";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { ChevronDown } from "@preprocess/ui/lib/icons";
import { cn } from "@preprocess/ui/lib/utils";
import { LEVELS, type LogLevel } from "@preprocess/logs";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { parseAgentCaseRef } from "../agent-cases/agent-case-ref";
import { useOrganizationId } from "../auth/auth-context";
import { ApiError, orgApi } from "../auth/client";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsError,
  SettingsSearchField,
  SettingsSection,
  SettingsSkeletonRows,
} from "../settings/kit";

/**
 * An agent's run logs across its cases and deployments (design doc 09): the
 * newest first, a level filter with counts over what is loaded, a search the
 * API runs, and older pages on request. For Developers, Owners and Admins.
 */

export type Log = {
  readonly id: string;
  readonly at: string;
  readonly agentId: string | null;
  readonly deploymentId: string | null;
  readonly caseId: string | null;
  readonly source: "platform" | "agent";
  readonly level: LogLevel;
  readonly kind: string;
  readonly message: string;
  readonly durationMs: number | null;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly error: {
    readonly message: string;
    readonly why?: string;
    readonly fix?: string;
    readonly status?: number;
  } | null;
  readonly data: Readonly<Record<string, unknown>>;
};

type LogPage = { logs: Log[]; cursor: string | null };

type Filter = "all" | LogLevel;

const PAGE = 500;

const LEVEL_LABEL: Record<LogLevel, string> = {
  error: "Errors",
  warn: "Warnings",
  info: "Info",
  debug: "Debug",
};

const LEVEL_BADGE = {
  error: { color: "red", label: "Error" },
  warn: { color: "amber", label: "Warning" },
  info: { color: "gray", label: "Info" },
  debug: { color: "gray", label: "Debug" },
} as const;

const FILTERS: readonly Filter[] = ["all", ...[...LEVELS].reverse()] as const;

const countFormat = new Intl.NumberFormat();
const timeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "failed"; error: unknown }
  | { kind: "ready"; logs: Log[]; cursor: string | null };

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function logsPath(agentId: string, search: string, cursor?: string) {
  const query = new URLSearchParams({ agent: agentId, limit: String(PAGE) });
  if (search) query.set("search", search);
  if (cursor) query.set("cursor", cursor);
  return `/logs?${query}`;
}

export function AgentLogs({ agentSlug }: Readonly<{ agentSlug: string }>) {
  const organizationId = useOrganizationId();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim(), 300);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    (async () => {
      const agent = await orgApi<{ id: string }>(
        organizationId,
        `/agents/${encodeURIComponent(agentSlug)}`,
      );
      const page = await orgApi<LogPage>(
        organizationId,
        logsPath(agent.id, search),
      );
      if (!live) return;
      setAgentId(agent.id);
      setState({ kind: "ready", logs: page.logs, cursor: page.cursor });
    })().catch((error: unknown) => {
      if (!live) return;
      setState(
        error instanceof ApiError && error.status === 404
          ? { kind: "missing" }
          : { kind: "failed", error },
      );
    });
    return () => {
      live = false;
    };
  }, [organizationId, agentSlug, search]);

  const loadOlder = async () => {
    if (state.kind !== "ready" || !state.cursor || !agentId) return;
    setLoadingOlder(true);
    try {
      const page = await orgApi<LogPage>(
        organizationId,
        logsPath(agentId, search, state.cursor),
      );
      setState({
        kind: "ready",
        logs: [...state.logs, ...page.logs],
        cursor: page.cursor,
      });
    } catch (error) {
      setState({ kind: "failed", error });
    } finally {
      setLoadingOlder(false);
    }
  };

  const logs = state.kind === "ready" ? state.logs : [];
  const counts = new Map<Filter, number>([["all", logs.length]]);
  for (const log of logs)
    counts.set(log.level, (counts.get(log.level) ?? 0) + 1);
  const shown =
    filter === "all" ? logs : logs.filter((log) => log.level === filter);
  const more = state.kind === "ready" && state.cursor !== null;

  return (
    <SettingsSection
      description="Console output, errors and platform events from this agent's cases in the last 7 days, newest first."
      title="Logs"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          aria-label="Log level"
          onValueChange={(value) => setFilter(value as Filter)}
          value={filter}
        >
          <TabsList>
            {FILTERS.map((value) => {
              const count = counts.get(value) ?? 0;
              const label = value === "all" ? "All" : LEVEL_LABEL[value];
              return (
                <TabItem
                  key={value}
                  label={`${label} ${countFormat.format(count)}${more ? "+" : ""}`}
                  value={value}
                />
              );
            })}
          </TabsList>
        </Tabs>
        <SettingsSearchField
          className="min-w-48 flex-1"
          label="Search logs"
          onChange={setQuery}
          placeholder="Search messages"
          value={query}
        />
      </div>
      {state.kind === "loading" ? (
        <SettingsCard>
          <SettingsSkeletonRows count={6} />
        </SettingsCard>
      ) : state.kind === "missing" ? (
        <SettingsEmpty
          description="Logs appear once this agent is deployed and runs a case."
          title="No logs yet"
        />
      ) : state.kind === "failed" ? (
        <SettingsError error={state.error} />
      ) : shown.length === 0 ? (
        <SettingsEmpty
          description={
            search
              ? "No logs match this search. Try other words."
              : filter === "all"
                ? "Logs appear here as this agent runs cases."
                : `No ${LEVEL_LABEL[filter].toLowerCase()} in the logs loaded so far.`
          }
          title={search ? "No matching logs" : "No logs"}
        />
      ) : (
        <LogList agentSlug={agentSlug} logs={shown} />
      )}
      {more ? (
        <div className="flex justify-center">
          <Button
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
            type="button"
            variant="secondary"
          >
            {loadingOlder ? "Loading…" : "Load older logs"}
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  );
}

/** Logs as rows in one card; a row opens to show its details. */
export function LogList({
  logs,
  agentSlug,
}: Readonly<{ logs: readonly Log[]; agentSlug?: string }>) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <SettingsCard className="flex flex-col divide-y divide-border/60">
      {logs.map((log) => (
        <LogRow
          agentSlug={agentSlug}
          key={log.id}
          log={log}
          onToggle={() => setOpen(open === log.id ? null : log.id)}
          open={open === log.id}
        />
      ))}
    </SettingsCard>
  );
}

function LogRow({
  log,
  open,
  onToggle,
  agentSlug,
}: Readonly<{
  log: Log;
  open: boolean;
  onToggle: () => void;
  agentSlug?: string;
}>) {
  const at = new Date(log.at);
  const badge = LEVEL_BADGE[log.level];
  const details: [string, string][] = [
    ["Kind", log.kind],
    ["Source", log.source === "agent" ? "Agent code" : "Platform"],
    ...(log.deploymentId
      ? ([["Deployment", log.deploymentId]] as [string, string][])
      : []),
    ...(log.durationMs !== null
      ? ([["Duration", `${countFormat.format(log.durationMs)} ms`]] as [
          string,
          string,
        ][])
      : []),
    ...(log.traceId ? ([["Trace", log.traceId]] as [string, string][]) : []),
    ...(log.error?.why ? ([["Why", log.error.why]] as [string, string][]) : []),
    ...(log.error?.fix ? ([["Fix", log.error.fix]] as [string, string][]) : []),
  ];
  const data = Object.keys(log.data).length
    ? JSON.stringify(log.data, null, 2)
    : null;
  return (
    <div className="flex flex-col">
      <button
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-3 px-5 py-2 text-left outline-none hover:bg-hover focus-visible:bg-hover"
        onClick={onToggle}
        type="button"
      >
        <time
          className="w-28 shrink-0 text-caption text-muted-foreground tabular-nums"
          dateTime={log.at}
          title={at.toLocaleString()}
        >
          {timeFormat.format(at)}
        </time>
        <Badge className="shrink-0" color={badge.color}>
          {badge.label}
        </Badge>
        <span
          className={cn(
            "min-w-0 flex-1 text-body text-foreground",
            open ? "break-words whitespace-pre-wrap" : "truncate",
          )}
        >
          {log.message}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180",
          )}
          size={16}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 px-5 pt-1 pb-4 pl-36">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-caption">
            {log.caseId ? (
              <>
                <dt className="text-muted-foreground">Case</dt>
                <dd className="min-w-0 truncate text-foreground">
                  {agentSlug ? (
                    <Link
                      className="underline-offset-2 hover:underline"
                      params={parseAgentCaseRef({
                        agentId: agentSlug,
                        caseId: log.caseId,
                      })}
                      to="/agents/$agentId/cases/$caseId"
                    >
                      {log.caseId}
                    </Link>
                  ) : (
                    log.caseId
                  )}
                </dd>
              </>
            ) : null}
            {details.map(([label, value]) => (
              <div className="contents" key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-words text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          {data ? (
            <ScrollArea
              className="max-h-64 rounded-lg bg-muted"
              orientation="both"
            >
              <pre
                className="px-3 py-2 font-mono text-caption text-foreground"
                style={{ fontVariationSettings: fontWeights.normal }}
              >
                {data}
              </pre>
            </ScrollArea>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
