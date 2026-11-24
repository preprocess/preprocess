// `preprocess logs` (design doc 09): an agent's or a case's run logs, newest
// first, one line each.

export type LogsOptions = {
  api: string;
  org: string;
  key: string;
  agent?: string | undefined;
  case?: string | undefined;
  deployment?: string | undefined;
  level?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  fetch?: typeof fetch;
};

type Log = {
  at: string;
  level: string;
  source: string;
  kind: string;
  caseId: string | null;
  message: string;
  durationMs: number | null;
  error: { message: string } | null;
};

export const logs = async (options: LogsOptions) => {
  const route = options.case
    ? "cases/" + encodeURIComponent(options.case) + "/logs"
    : "logs";
  const url = new URL(
    "v1/orgs/" + encodeURIComponent(options.org) + "/" + route,
    options.api.endsWith("/") ? options.api : options.api + "/",
  );
  const filters = {
    agent: options.case ? undefined : options.agent,
    deployment: options.case ? undefined : options.deployment,
    level: options.level,
    search: options.search,
    limit: options.limit?.toString(),
  };
  for (const [name, value] of Object.entries(filters))
    if (value) url.searchParams.set(name, value);
  const response = await (options.fetch ?? fetch)(url, {
    headers: { authorization: "Bearer " + options.key },
  });
  const body = (await response.json()) as {
    logs?: Log[];
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      "GET " +
        route +
        " failed (" +
        response.status +
        "): " +
        (body.error?.message ?? "unknown error"),
    );
  const lines = (body.logs ?? []).map((log) =>
    [
      log.at,
      log.level.toUpperCase().padEnd(5),
      log.source === "agent" ? "agent   " : "platform",
      (log.caseId ?? "-").padEnd(10),
      log.kind,
      log.message +
        (log.durationMs === null
          ? ""
          : " (" + Math.round(log.durationMs) + "ms)") +
        (log.error && log.error.message !== log.message
          ? " — " + log.error.message
          : ""),
    ].join("  "),
  );
  return { out: lines.length ? lines.join("\n") : "No logs." };
};
