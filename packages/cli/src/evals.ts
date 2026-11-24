// `preprocess evals` (design doc 09): list an agent's eval suites, and run a
// suite against a deployment, one run per model, printing each run's result.

export type EvalsTarget = {
  api: string;
  org: string;
  key: string;
  fetch?: typeof fetch;
};

type Run = {
  id: string;
  model: string;
  status: string;
  cases: number;
  passed: number;
  failed: number;
  neededPerson: number;
  passRate: number | null;
  costUsd: number;
};

type Suite = {
  id: string;
  name: string;
  kind: string;
  cap: number | null;
  cases: number;
  latestRun: Run | null;
};

const request = async <T>(
  target: EvalsTarget,
  method: string,
  route: string,
  body?: unknown,
) => {
  const url = new URL(
    "v1/orgs/" + encodeURIComponent(target.org) + "/" + route,
    target.api.endsWith("/") ? target.api : target.api + "/",
  );
  const response = await (target.fetch ?? fetch)(url, {
    method,
    headers: {
      authorization: "Bearer " + target.key,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok)
    throw new Error(
      `${method} ${route} failed (${response.status}): ${json.error?.message ?? "unknown error"}`,
    );
  return json;
};

const percent = (rate: number | null) =>
  rate === null ? "-" : Math.round(rate * 100) + "%";

const runLine = (run: Run) =>
  [
    run.model.padEnd(24),
    run.status.padEnd(9),
    `${percent(run.passRate)} passed (${run.passed}/${run.cases})`,
    `${run.failed} failed`,
    `${run.neededPerson} needed a person`,
    `$${run.costUsd.toFixed(4)}`,
  ].join("  ");

export const evalsList = async (target: EvalsTarget & { agent: string }) => {
  const { suites } = await request<{ suites: Suite[] }>(
    target,
    "GET",
    "agents/" + encodeURIComponent(target.agent) + "/eval-suites",
  );
  if (suites.length === 0)
    return {
      out: "No eval suites yet: one is created with the first completed case.",
    };
  return {
    out: suites
      .map((s) =>
        [
          s.id,
          s.kind.padEnd(9),
          `${s.cases} cases${s.cap === null ? "" : ` (cap ${s.cap})`}`,
          s.name,
          s.latestRun ? "latest: " + percent(s.latestRun.passRate) : "",
        ].join("  "),
      )
      .join("\n"),
  };
};

// Starts the runs and waits until each one finishes.
export const evalsRun = async (
  target: EvalsTarget & {
    suite: string;
    deployment?: string | undefined;
    models?: string[] | undefined;
    pollMs?: number;
    timeoutMs?: number;
  },
) => {
  const { runs } = await request<{ runs: Run[] }>(
    target,
    "POST",
    "eval-suites/" + encodeURIComponent(target.suite) + "/runs",
    {
      ...(target.deployment && { deployment: target.deployment }),
      ...(target.models?.length && { models: target.models }),
    },
  );
  const deadline = Date.now() + (target.timeoutMs ?? 30 * 60_000);
  let current = runs;
  while (current.some((r) => r.status === "running" || r.status === "queued")) {
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, target.pollMs ?? 2000));
    current = await Promise.all(
      current.map((r) =>
        r.status === "running" || r.status === "queued"
          ? request<Run>(target, "GET", "eval-runs/" + encodeURIComponent(r.id))
          : Promise.resolve(r),
      ),
    );
  }
  return {
    code: current.every((r) => r.status === "completed") ? 0 : 1,
    out: current.map(runLine).join("\n"),
  };
};
