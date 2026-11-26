import { useCallback, useEffect, useState } from "react";

import { useOrganizationId } from "../auth/auth-context";
import { ApiError, orgApi } from "../auth/client";

// The eval API's shapes (design doc 09) and a small loader for the pages.
// Owners, Admins and the Developers group read and run evals.

export type EvalRunStatus = "queued" | "running" | "completed" | "failed";

export type EvalRun = {
  readonly id: string;
  readonly suiteId: string;
  readonly deploymentId: string;
  readonly model: string;
  readonly trigger: "manual" | "push";
  readonly status: EvalRunStatus;
  readonly cases: number;
  readonly passed: number;
  readonly neededPerson: number;
  readonly failed: number;
  readonly passRate: number | null;
  readonly costUsd: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly finishedAt: string | null;
};

export type EvalSuite = {
  readonly id: string;
  readonly agentId: string;
  readonly name: string;
  readonly kind: "automatic" | "manual";
  readonly cap: number | null;
  readonly runOnPush: boolean;
  readonly cases: number;
  readonly latestRun: EvalRun | null;
  readonly createdAt: string;
};

export type EvalSuiteCase = {
  readonly caseId: string;
  readonly input: unknown;
  readonly expected: unknown;
  readonly original: unknown;
  readonly addedAt: string;
};

export type EvalSuiteDetail = EvalSuite & {
  readonly suiteCases: readonly EvalSuiteCase[];
  readonly runs: readonly EvalRun[];
};

export type EvalResultStatus =
  "running" | "passed" | "failed" | "needed_person" | "error";

export type EvalResult = {
  readonly caseId: string;
  readonly status: EvalResultStatus;
  readonly fields:
    readonly { path: string; match: boolean; score: number }[] | null;
  readonly answers: unknown;
  readonly reason: string | null;
  readonly costUsd: number;
};

export type EvalRunDetail = EvalRun & {
  readonly fields: readonly { path: string; matchRate: number }[];
  readonly results: readonly EvalResult[];
};

export type AgentDeploymentSummary = {
  readonly id: string;
  readonly status: "ready" | "waiting" | "failed" | "building";
  readonly production: boolean;
  readonly model: string;
  readonly git: { branch: string | null; commit: string | null };
  readonly createdAt: string;
};

export type Loaded<T> =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "failed"; error: unknown }
  | { kind: "ready"; data: T };

/**
 * GETs an org route and reloads on demand, or every few seconds while
 * `poll` says the data is still moving (a run in progress). A 404 is
 * "missing": an agent the API doesn't know, or a deleted suite.
 */
export function useOrgJson<T>(path: string, poll?: (data: T) => boolean) {
  const organizationId = useOrganizationId();
  const [state, setState] = useState<Loaded<T>>({ kind: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    orgApi<T>(organizationId, path)
      .then((data) => live && setState({ kind: "ready", data }))
      .catch(
        (error: unknown) =>
          live &&
          setState(
            error instanceof ApiError && error.status === 404
              ? { kind: "missing" }
              : { kind: "failed", error },
          ),
      );
    return () => {
      live = false;
    };
  }, [organizationId, path, version]);

  const moving = state.kind === "ready" && poll ? poll(state.data) : false;
  useEffect(() => {
    if (!moving) return;
    const timer = setTimeout(reload, 3000);
    return () => clearTimeout(timer);
  }, [moving, state, reload]);

  return { state, reload, organizationId };
}

const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});
const dollars = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export const formatRate = (rate: number | null) =>
  rate === null ? "—" : percent.format(rate);
export const formatUsd = (value: number) => dollars.format(value);
export const shortId = (id: string) => id.replace(/^[a-z]+_/, "").slice(-7);

export const RUN_STATUS = {
  queued: { color: "gray", label: "Queued" },
  running: { color: "blue", label: "Running" },
  completed: { color: "green", label: "Completed" },
  failed: { color: "red", label: "Failed" },
} as const;

export const RESULT_STATUS = {
  running: { color: "blue", label: "Running" },
  passed: { color: "green", label: "Passed" },
  failed: { color: "red", label: "Failed" },
  needed_person: { color: "amber", label: "Needed a person" },
  error: { color: "red", label: "Error" },
} as const;

/** The case's text, for a one-line preview. */
export function inputText(input: unknown) {
  if (input && typeof input === "object" && "text" in input) {
    const text = input.text;
    if (typeof text === "string") return text;
  }
  return JSON.stringify(input);
}
