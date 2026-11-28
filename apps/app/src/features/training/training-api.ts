// Training (PRE-145, design doc 10): an agent's datasets, their live preview
// and the NDJSON exports of datasets and run capture. "live" reads /v1 from
// the browser; in development the other "training" scenarios serve seeded
// datasets and answer writes and exports as the API would.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";

import { currentScenario } from "../../scenarios/current-scenario";
import type { ScenarioState } from "../../scenarios/scenarios";
import { useOrganizationId } from "../auth/auth-context";
import { ApiError, orgApi, orgText } from "../auth/client";
import { shortId } from "../evals/eval-api";
import { useCanDeploy } from "../settings/use-role";

export const CLOSED = ["completed", "failed", "halted", "cancelled"] as const;
export type ClosedStatus = (typeof CLOSED)[number];

export const PERIODS = ["7d", "30d", "90d", "all"] as const;
export type Period = (typeof PERIODS)[number];

export type Edited = { any: true } | { fields: string[] } | { none: true };

export type DatasetQuery = {
  period?: Period;
  from?: string;
  to?: string;
  status?: ClosedStatus[];
  deployments?: string[];
  edited?: Edited;
  outcome?: "corrected" | "accepted";
};

export type Dataset = {
  id: string;
  name: string;
  query: DatasetQuery;
  count: number | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type PreviewCase = {
  id: string;
  title: string | null;
  status: ClosedStatus;
  completedAt: string | null;
  editedFields: string[];
};

export type Preview = { count: number; cases: PreviewCase[] };

export type DatasetFormat = "sft" | "preference" | "replay";

export type TrainingDeployment = { id: string; production: boolean };

/** The default query a new dataset starts with. */
export const DEFAULT_QUERY: DatasetQuery = {
  period: "30d",
  status: ["completed"],
};

/** The agent's cases are hidden from this person: the API answers 404. */
export class NoCaseAccess extends Error {}

type State = ScenarioState<"training">;
const scenario = (): State => currentScenario().training;

const agentPath = (agent: string) => "/agents/" + encodeURIComponent(agent);
const datasetPath = (agent: string, id: string) =>
  agentPath(agent) + "/datasets/" + encodeURIComponent(id);

const never = <T>() => new Promise<T>(() => {});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A 404 from a read of an agent the page already loaded means the person
// can't see its cases.
async function read<T>(load: () => Promise<T>) {
  try {
    return await load();
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404)
      throw new NoCaseAccess();
    throw cause;
  }
}

// ─── Seeded ──────────────────────────────────────────────────────────────────

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const SEEDED_DEPLOYMENTS: TrainingDeployment[] = [
  { id: "k7PqW2d", production: true },
  { id: "m2Xa9Qe", production: false },
];

const SEEDED_FIELDS = ["amount", "due_date", "term_months", "contact_email"];

const SEEDED_CASES: [string, string[], number][] = [
  ["Northwind Logistics", ["amount", "due_date"], 2 * HOUR],
  ["Harbor Freight Co.", ["amount"], 3 * HOUR],
  ["Pinecrest Dental", ["term_months"], 5 * HOUR],
  ["Alder & Finch LLP", ["amount", "contact_email"], 26 * HOUR],
  ["Bluewater Marine", ["due_date"], 28 * HOUR],
  ["Cobalt Analytics", ["amount"], 30 * HOUR],
  ["Fieldstone Farms", ["amount", "term_months"], 2 * DAY],
  ["Granite Peak Health", ["contact_email"], 2 * DAY + HOUR],
  ["Juniper Schools", ["amount"], 2 * DAY + 3 * HOUR],
  ["Keystone Roofing", ["due_date"], 3 * DAY],
  ["Lumen Optics", ["amount"], 3 * DAY + HOUR],
  ["Meridian Travel", ["amount", "due_date"], 3 * DAY + 2 * HOUR],
  ["Northstar Credit Union", ["term_months"], 4 * DAY],
  ["Oakridge Veterinary", ["amount"], 4 * DAY + HOUR],
  ["Parkline Studios", ["contact_email"], 5 * DAY],
  ["Quarry Lane Bakery", ["amount"], 5 * DAY + HOUR],
  ["Riverbend Clinic", ["amount", "due_date"], 6 * DAY],
  ["Summit Legal Group", ["due_date"], 6 * DAY + HOUR],
  ["Tidewater Supply", ["amount"], 7 * DAY],
  ["Union Street Cafe", ["term_months"], 7 * DAY + HOUR],
  ["Vantage Robotics", ["amount"], 8 * DAY],
  ["Westbrook Dental", ["due_date"], 8 * DAY + HOUR],
];

// A plausible count for a seeded query, so the preview moves as it changes.
function seededCount(query: DatasetQuery) {
  const days = query.period
    ? { "7d": 146, "30d": 612, "90d": 1846, all: 2158 }[query.period]
    : 540;
  const statuses = query.status ?? [...CLOSED];
  const share = statuses.reduce(
    (sum, status) => sum + (status === "completed" ? 0.85 : 0.05),
    0,
  );
  const edited = !query.edited
    ? 1
    : "any" in query.edited
      ? 0.4
      : "fields" in query.edited
        ? 0.0785 * query.edited.fields.length
        : 0.6;
  const outcome =
    query.outcome === "corrected"
      ? 0.2625
      : query.outcome === "accepted"
        ? 0.6
        : 1;
  const deployments = query.deployments?.length
    ? query.deployments.includes("k7PqW2d")
      ? 0.9
      : 0.1
    : 1;
  return Math.round(days * share * edited * outcome * deployments);
}

function seededPreview(query: DatasetQuery): Preview {
  if (scenario() === "no-matches") return { count: 0, cases: [] };
  const fields =
    query.edited && "fields" in query.edited ? query.edited.fields : null;
  const now = Date.now();
  const cases = SEEDED_CASES.filter(
    ([, edited]) => !fields || edited.some((field) => fields.includes(field)),
  )
    .slice(0, 20)
    .map(([name, edited, ago], index) => ({
      id: "case_seed" + index,
      title: "Renewal · " + name,
      status: "completed" as const,
      completedAt: new Date(now - ago).toISOString(),
      editedFields: query.edited && "none" in query.edited ? [] : edited,
    }));
  const count = seededCount(query);
  return { count, cases: count ? cases : [] };
}

const seededDatasets = new Map<string, Dataset[]>();

function seededList(agent: string) {
  let list = seededDatasets.get(agent);
  if (!list) {
    const now = Date.now();
    const queries: [string, string, DatasetQuery, string][] = [
      [
        "corrected-renewals",
        "Corrected renewals",
        { period: "90d", status: ["completed"], outcome: "corrected" },
        new Date(now - 2 * HOUR).toISOString(),
      ],
      [
        "all-completed",
        "All completed",
        { period: "all", status: ["completed"] },
        "2026-11-20T16:10:00.000Z",
      ],
      [
        "amount-edits",
        "Amount edits",
        { period: "30d", edited: { fields: ["amount", "due_date"] } },
        "2026-11-14T18:40:00.000Z",
      ],
    ];
    list = queries.map(([id, name, query, updatedAt]) => ({
      id,
      name,
      query,
      count: seededCount(query),
      updatedAt,
      updatedBy: "Dana Whitfield",
    }));
    seededDatasets.set(agent, list);
  }
  return list;
}

/** Seeded reads by scenario; undefined never settles, for loading. */
function seeded<T>(make: () => T): Promise<T> {
  switch (scenario()) {
    case "loading":
      return never<T>();
    case "error":
      return Promise.reject(new ApiError("Something went wrong.", 500));
    case "no-access":
      return Promise.reject(new NoCaseAccess());
    case "live":
    case "seeded":
    case "operator":
    case "off":
    case "empty":
    case "no-matches":
      return wait(250).then(make);
  }
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Whether this person may create datasets and export: Developers, Admins
 *  and Owners, as the API checks. Operators and viewers only read. */
export function useCanExport() {
  const canDeploy = useCanDeploy();
  const state = scenario();
  return state === "live" ? canDeploy : state !== "operator";
}

/** Whether the install's training switch is on (Coming soon lines show). */
export function useTrainingOn() {
  const organizationId = useOrganizationId();
  const state = scenario();
  const switched = useQuery({
    queryKey: ["training", organizationId, "switch", state],
    queryFn: () =>
      state === "live"
        ? orgApi<{ service: "on" | "off" }>(organizationId, "/training")
        : Promise.resolve({ service: state === "off" ? "off" : "on" }),
  });
  return switched.data?.service === "on";
}

export function useDatasets(agent: string) {
  const organizationId = useOrganizationId();
  const state = scenario();
  return useQuery({
    queryKey: ["training", organizationId, agent, "datasets", state],
    retry: false,
    queryFn: async (): Promise<Dataset[]> => {
      if (state === "empty") return seeded(() => []);
      if (state !== "live") return seeded(() => [...seededList(agent)]);
      const { items } = await read(() =>
        orgApi<{ items: ApiDataset[] }>(
          organizationId,
          agentPath(agent) + "/datasets",
        ),
      );
      return items.map(fromApi);
    },
  });
}

export function useDataset(agent: string, id: string) {
  const organizationId = useOrganizationId();
  const state = scenario();
  return useQuery({
    queryKey: ["training", organizationId, agent, "dataset", id, state],
    retry: false,
    queryFn: async (): Promise<Dataset> => {
      if (state !== "live")
        return seeded(() => {
          const dataset = seededList(agent).find((d) => d.id === id);
          if (!dataset) throw new ApiError("No such dataset.", 404);
          return dataset;
        });
      return fromApi(
        await read(() =>
          orgApi<ApiDataset>(organizationId, datasetPath(agent, id)),
        ),
      );
    },
  });
}

/** The cases a query holds, re-read as the query changes. */
export function usePreview(agent: string, id: string, query: DatasetQuery) {
  const organizationId = useOrganizationId();
  const state = scenario();
  const encoded = JSON.stringify(query);
  return useQuery({
    queryKey: [
      "training",
      organizationId,
      agent,
      "preview",
      id,
      encoded,
      state,
    ],
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: async (): Promise<Preview> => {
      if (state !== "live")
        return seeded(() => seededPreview(query)).then(async (preview) => {
          await wait(400);
          return preview;
        });
      return read(() =>
        orgApi<Preview>(
          organizationId,
          datasetPath(agent, id) +
            "/preview?limit=20&query=" +
            encodeURIComponent(encoded),
        ),
      );
    },
  });
}

export function useDeployments(agent: string) {
  const organizationId = useOrganizationId();
  const state = scenario();
  return useQuery({
    queryKey: ["training", organizationId, agent, "deployments", state],
    queryFn: async (): Promise<TrainingDeployment[]> =>
      state === "live"
        ? (
            await orgApi<TrainingDeployment[]>(
              organizationId,
              agentPath(agent) + "/deployments",
            )
          ).map(({ id, production }) => ({ id, production }))
        : SEEDED_DEPLOYMENTS,
  });
}

/** The answer fields to offer for "These fields". */
export function useAnswerFields(agent: string) {
  const organizationId = useOrganizationId();
  const state = scenario();
  return useQuery({
    queryKey: ["training", organizationId, agent, "answer-fields", state],
    queryFn: async (): Promise<string[]> =>
      state === "live"
        ? (
            await orgApi<{ fields: string[] }>(
              organizationId,
              agentPath(agent) + "/answer-fields",
            )
          ).fields
        : SEEDED_FIELDS,
  });
}

export const deploymentLabel = (deployment: TrainingDeployment) =>
  shortId(deployment.id) +
  " · " +
  (deployment.production ? "production" : "preview");

type ApiDataset = {
  id: string;
  name: string;
  query: DatasetQuery;
  count: number;
  updatedAt: string;
  updatedBy: { id: string; name: string | null };
};

const fromApi = (item: ApiDataset): Dataset => ({
  id: item.id,
  name: item.name,
  query: item.query,
  count: item.count,
  updatedAt: item.updatedAt,
  updatedBy: item.updatedBy.name,
});

// ─── Writes ──────────────────────────────────────────────────────────────────

/** Creates, renames, re-queries and deletes datasets. A taken name throws
 *  an ApiError with status 409. */
export function useDatasetWrites(agent: string) {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["training", organizationId, agent],
    });
  const taken = (name: string, except?: string) =>
    seededList(agent).some((d) => d.name === name && d.id !== except);

  const create = async (name: string): Promise<string> => {
    if (scenario() === "live") {
      const dataset = await orgApi<ApiDataset>(
        organizationId,
        agentPath(agent) + "/datasets",
        {
          method: "POST",
          body: JSON.stringify({ name, query: DEFAULT_QUERY }),
        },
      );
      await refresh();
      return dataset.id;
    }
    await wait(600);
    if (taken(name)) throw new ApiError("Name taken.", 409);
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "dataset";
    seededList(agent).push({
      id,
      name,
      query: DEFAULT_QUERY,
      count: seededCount(DEFAULT_QUERY),
      updatedAt: new Date().toISOString(),
      updatedBy: "Dana Whitfield",
    });
    await refresh();
    return id;
  };

  const update = async (
    id: string,
    change: { name?: string; query?: DatasetQuery },
  ) => {
    if (scenario() === "live") {
      await orgApi(organizationId, datasetPath(agent, id), {
        method: "PATCH",
        body: JSON.stringify(change),
      });
    } else {
      await wait(600);
      if (change.name && taken(change.name, id))
        throw new ApiError("Name taken.", 409);
      const dataset = seededList(agent).find((d) => d.id === id);
      if (dataset)
        Object.assign(dataset, change, {
          count: seededCount(change.query ?? dataset.query),
          updatedAt: new Date().toISOString(),
        });
    }
    await refresh();
  };

  const remove = async (id: string) => {
    if (scenario() === "live") {
      await orgApi(organizationId, datasetPath(agent, id), {
        method: "DELETE",
      });
    } else {
      await wait(600);
      const list = seededList(agent);
      list.splice(
        list.findIndex((d) => d.id === id),
        1,
      );
    }
    await refresh();
  };

  return { create, update, remove };
}

// ─── Export ──────────────────────────────────────────────────────────────────

export type ExportState =
  | { kind: "idle"; failed?: boolean }
  | { kind: "exporting"; done: number; total: number | null }
  | { kind: "done"; count: number; skipped: number };

const PAGE = 500;

/** The from/to a period stands for, as the export and count take them. */
export function periodRange(
  query: Pick<DatasetQuery, "period" | "from" | "to">,
) {
  if (!query.period) return { from: query.from, to: query.to };
  if (query.period === "all") return {};
  const days = { "7d": 7, "30d": 30, "90d": 90 }[query.period];
  return { from: new Date(Date.now() - days * DAY).toISOString() };
}

/**
 * Runs one export: follows the NDJSON pages' next cursors into one file,
 * counting lines against the total, then downloads it.
 */
export function useExport() {
  const organizationId = useOrganizationId();
  const [state, setState] = useState<ExportState>({ kind: "idle" });

  const run = async ({
    path,
    params,
    total,
    filename,
  }: {
    path: string;
    params: Record<string, string | undefined>;
    total: () => Promise<number | null>;
    filename: string;
  }) => {
    setState({ kind: "exporting", done: 0, total: null });
    try {
      const known = await total().catch(() => null);
      setState({ kind: "exporting", done: 0, total: known });
      const lines: string[] = [];
      let skipped = 0;
      let cursor: string | null | undefined;
      do {
        const search = new URLSearchParams({ limit: String(PAGE) });
        for (const [key, value] of Object.entries(params))
          if (value) search.set(key, value);
        if (cursor) search.set("cursor", cursor);
        const page =
          scenario() === "live"
            ? await orgText(organizationId, path + "?" + search.toString())
            : await seededPage(known ?? 0, lines.length);
        const rows = page.split("\n").filter(Boolean);
        const trailer = JSON.parse(rows.pop() ?? "{}") as {
          next?: string | null;
          skipped?: number;
        };
        lines.push(...rows);
        skipped += trailer.skipped ?? 0;
        cursor = trailer.next;
        setState({ kind: "exporting", done: lines.length, total: known });
      } while (cursor);
      download(lines, filename);
      setState({ kind: "done", count: lines.length, skipped });
    } catch {
      setState({ kind: "idle", failed: true });
    }
  };

  return { state, run };
}

// A seeded export page: up to 200 lines a second, the last page saying 12
// cases were past retention.
async function seededPage(total: number, done: number) {
  await wait(900);
  const size = Math.min(200, total - done);
  const rows = Array.from({ length: size }, (_, i) =>
    JSON.stringify({ case: { id: "case_seed" + (done + i) } }),
  );
  const last = done + size >= total;
  rows.push(
    JSON.stringify({
      next: last ? null : String(done + size),
      skipped: last && total ? 12 : 0,
    }),
  );
  return rows.join("\n");
}

function download(lines: string[], filename: string) {
  const blob = new Blob([lines.join("\n") + (lines.length ? "\n" : "")], {
    type: "application/x-ndjson",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Run capture's export for a period, totalled by the capture count. */
export function useCaptureExport(agent: string) {
  const organizationId = useOrganizationId();
  const { state, run } = useExport();
  const start = (query: Pick<DatasetQuery, "period" | "from" | "to">) => {
    const range = periodRange(query);
    const search = new URLSearchParams();
    if (range.from) search.set("from", range.from);
    if (range.to) search.set("to", range.to);
    return run({
      path: agentPath(agent) + "/capture/export",
      params: range,
      filename: "capture-" + agent + ".ndjson",
      total: async () =>
        scenario() === "live"
          ? (
              await orgApi<{ count: number }>(
                organizationId,
                agentPath(agent) + "/capture/count?" + search.toString(),
              )
            ).count
          : seededCount({ ...query, status: [...CLOSED] }),
    });
  };
  return { state, start };
}

/** A dataset's export in one format, totalled by its preview count. */
export function useDatasetExport(
  agent: string,
  dataset: Dataset,
  format: DatasetFormat,
  count: number | null,
) {
  const { state, run } = useExport();
  const start = () =>
    run({
      path: datasetPath(agent, dataset.id) + "/export",
      params: { format },
      filename: "dataset-" + dataset.id + "-" + format + ".ndjson",
      total: () => Promise.resolve(count),
    });
  return { state, start };
}
