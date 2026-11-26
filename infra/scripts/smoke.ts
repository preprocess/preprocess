// End-to-end check of a deployed stage, run on staging before production (and
// usable on any stage). OUTPUTS is the JSON scripts/stage.ts printed.
//
// 1. The API answers its health check and the app serves its sign-in page.
// 2. Auth round trip through the app's origin (the app forwards /api/auth to
//    the API): sign in as the stage's smoke-test user, signing up on the
//    first run, then read the session back.
// 3. In the smoke-test organization, deploy a stub agent (smoke-agent/agent.ts) and
//    run one case on it to completion.
//
// With SMOKE=sandbox, step 3 deploys smoke-agent/sandbox.ts instead, whose case
// runs one command in a small sandbox. Once the sandbox's interval closes, it
// prints the container's start and stop from the case's run log next to the
// interval the API timed and billed, and writes that table to the GitHub job
// summary when there is one.
//
// With SMOKE=layer, step 3 deploys smoke-agent/layer.ts, whose sandbox has a
// custom environment (one apt package and one file). It waits for the layer
// to build, runs a case whose first command uses both, and reports the
// layer's size, how long the deploy took to become ready, how long the mount
// took (from the run log), and whether the command saw the package and file.
//
// The user is reused across runs. Sign-in is by emailed link, and the smoke
// test has no mailbox: for its address only, the API derives the link's token
// from the stage's BETTER_AUTH_SECRET and the current minute, so the token is
// never stored here and differs per stage (apps/api/src/auth.ts). The API
// mails nothing for that address, so each run sends no email.

import { createHmac } from "node:crypto";
import { appendFileSync } from "node:fs";
import path from "node:path";

import { buildSync } from "esbuild";

const { app, api } = JSON.parse(process.env.OUTPUTS ?? "{}") as {
  app?: string;
  api?: string;
};
if (!app || !api) throw new Error("OUTPUTS must carry app and api URLs");
const stage = process.env.STAGE ?? "staging";
const mode = process.env.SMOKE ?? "";
if (!["", "sandbox", "layer"].includes(mode))
  throw new Error(`SMOKE must be sandbox or layer, not ${mode}`);
const slug = mode ? `smoke-${mode}` : "smoke";
const authSecret = process.env.BETTER_AUTH_SECRET;
const emailFrom = process.env.EMAIL_FROM;
if (!authSecret || !emailFrom) {
  throw new Error("BETTER_AUTH_SECRET and EMAIL_FROM must be set");
}
const domain = /@([^>\s]+)>?\s*$/.exec(emailFrom)?.[1];
if (!domain) throw new Error("EMAIL_FROM has no address");
const email = `smoke-test+${stage}@${domain}`;
const tokenFor = (minute: number) =>
  createHmac("sha256", authSecret)
    .update(`smoke-test:${email}:${minute}`)
    .digest("hex");

const fail = (what: string): never => {
  throw new Error(`smoke test failed: ${what}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Session cookies, kept as a browser would for the app's origin.
const cookies = new Map<string, string>();
const call = async <T = unknown>(
  method: string,
  pathname: string,
  body?: unknown,
) => {
  const response = await fetch(new URL(pathname, app), {
    method,
    redirect: "manual",
    headers: {
      origin: new URL(app).origin,
      ...(cookies.size && {
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      }),
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  for (const header of response.headers.getSetCookie()) {
    const [pair = ""] = header.split(";");
    const at = pair.indexOf("=");
    if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const text = await response.text();
  console.log(`${method} ${pathname} -> ${response.status}`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, text, body: json as T };
};

// 1. Health. A new workers.dev subdomain can take a while to answer.
for (let attempt = 0; ; attempt++) {
  const status = await fetch(api)
    .then((r) => r.status)
    .catch(() => 0);
  if (status === 200) break;
  if (attempt > 30) fail(`API health check at ${api} never answered 200`);
  await sleep(2000);
}
console.log(`GET ${api} -> 200`);
const signInPage = await call("GET", "/sign-in");
if (signInPage.status !== 200 || !/<html/i.test(signInPage.text)) {
  fail("the app's sign-in page");
}

// 2. Auth round trip.
const asked = await call("POST", "/api/auth/sign-in/magic-link", {
  email,
  callbackURL: "/",
});
if (asked.status !== 200) fail(`asking for a sign-in link: ${asked.text}`);
// The API minted the token in the minute it answered, or just before.
const minute = Math.floor(Date.now() / 60_000);
let session = { body: null } as Awaited<
  ReturnType<typeof call<{ user?: { id: string; email?: string } } | null>>
>;
for (const at of [minute, minute - 1]) {
  await call(
    "GET",
    `/api/auth/magic-link/verify?${new URLSearchParams({ token: tokenFor(at), callbackURL: "/" }).toString()}`,
  );
  session = await call("GET", "/api/auth/get-session");
  if (session.body?.user) break;
}
const user = session.body?.user;
if (!user || user.email !== email) fail("the session after sign-in");
const named = await call("POST", "/api/auth/update-user", {
  firstName: "Smoke",
  lastName: "Test",
});
if (named.status !== 200) fail(`naming the user: ${named.text}`);

// 3. A case on a freshly deployed stub agent.
const orgs = await call<{ id: string; slug: string }[]>(
  "GET",
  "/api/auth/organization/list",
);
let org = orgs.body?.find((o) => o.slug.startsWith("smoke-test-"))?.id;
if (!org) {
  const created = await call<{ id: string }>(
    "POST",
    "/api/auth/organization/create",
    {
      name: "Smoke test",
      slug: `smoke-test-${crypto.randomUUID().slice(0, 8)}`,
    },
  );
  org = created.body?.id ?? fail(`creating the organization: ${created.text}`);
}

const built = buildSync({
  entryPoints: [
    path.join(import.meta.dirname, `../smoke-agent/${mode || "agent"}.ts`),
  ],
  define: {
    __SMOKE_RUN__: JSON.stringify(
      process.env.GITHUB_RUN_ID ?? String(Date.now()),
    ),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2023",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["module", "main"],
  external: ["cloudflare:*", "node:*"],
  logLevel: "warning",
});
type Deployment = {
  id: string;
  production: boolean;
  sandboxEnvironment: {
    status: "building" | "ready" | "failed";
    bytes?: number;
    error?: string;
    log?: string | null;
  } | null;
};
const deployStarted = Date.now();
let deployed = await call<Deployment>(
  "POST",
  `/v1/orgs/${org}/agents/${slug}/deployments`,
  {
    bundle: {
      mainModule: "agent.js",
      modules: { "agent.js": built.outputFiles[0]?.text ?? "" },
    },
    git: {
      branch: "main",
      commit: (process.env.GITHUB_SHA ?? "local").slice(0, 7),
    },
  },
);
if (deployed.status !== 201) fail(`deploying the agent: ${deployed.text}`);
// A custom environment builds after the deploy answers; the deployment
// promotes itself once it is ready.
for (let attempt = 0; mode === "layer"; attempt++) {
  const layer = deployed.body.sandboxEnvironment;
  if (!layer)
    fail(`the deployment has no custom environment: ${deployed.text}`);
  if (layer!.status === "failed")
    fail(`the custom environment failed: ${layer!.error}\n${layer!.log ?? ""}`);
  if (layer!.status === "ready") break;
  if (attempt > 360) fail("the custom environment never finished building");
  await sleep(2000);
  deployed = await call<Deployment>(
    "GET",
    `/v1/orgs/${org}/agents/${slug}/deployments/${deployed.body.id}`,
  );
  if (deployed.status !== 200) fail(`reading the deployment: ${deployed.text}`);
}
const readySeconds = (Date.now() - deployStarted) / 1000;
if (!deployed.body.production) {
  const promoted = await call(
    "POST",
    `/v1/orgs/${org}/agents/${slug}/deployments/${deployed.body.id}/promote`,
  );
  if (promoted.status !== 200) fail(`promoting the agent: ${promoted.text}`);
}

// Starting a case needs operator access, granted to a group the smoke-test
// user is in. Each call is idempotent, so later runs repeat it harmlessly.
const agent = await call<{ id: string }>(
  "GET",
  `/v1/orgs/${org}/agents/${slug}`,
);
if (agent.status !== 200) fail(`reading the agent: ${agent.text}`);
const groups = await call<{ id: string; slug: string }[]>(
  "GET",
  `/v1/orgs/${org}/groups`,
);
let group = groups.body?.find((g) => g.slug === "smoke-operators")?.id;
if (!group) {
  const created = await call<{ id: string }>("POST", `/v1/orgs/${org}/groups`, {
    name: "Smoke operators",
    slug: "smoke-operators",
  });
  group = created.body?.id ?? fail(`creating the group: ${created.text}`);
}
const member = await call(
  "PUT",
  `/v1/orgs/${org}/groups/${group}/members/${user!.id}`,
);
if (member.status >= 300) fail(`joining the group: ${member.text}`);
const grant = await call(
  "PUT",
  `/v1/orgs/${org}/agents/${agent.body.id}/grants/${group}`,
  { access: "operator" },
);
if (grant.status !== 200) fail(`granting operator access: ${grant.text}`);

const started = await call<{ id: string }>("POST", `/v1/orgs/${org}/cases`, {
  agent: slug,
  text:
    mode === "sandbox"
      ? `Smoke test of the sandbox on ${stage}.`
      : mode === "layer"
        ? `Smoke test of a custom environment on ${stage}.`
        : `Smoke test of ${stage}.`,
});
if (started.status !== 202) fail(`starting the case: ${started.text}`);
for (let attempt = 0; ; attempt++) {
  const state = await call<{ status: string }>(
    "GET",
    `/v1/orgs/${org}/cases/${started.body.id}`,
  );
  const status = state.body?.status;
  if (status === "completed") break;
  if (status === "failed" || status === "cancelled" || status === "halted") {
    fail(`the case ended ${status}: ${state.text}`);
  }
  if (attempt > 90) fail(`the case never completed (last: ${state.text})`);
  await sleep(2000);
}

if (mode === "sandbox") await measureSandbox(org, started.body.id);
if (mode === "layer")
  await reportLayer(
    org,
    started.body.id,
    deployed.body.id,
    deployed.body.sandboxEnvironment?.bytes ?? 0,
    readySeconds,
  );
console.log("smoke test passed");

// The case's sandbox intervals as the API timed and billed them, beside the
// container's start and stop as its Durable Object logged them. A positive
// difference is container time the interval did not bill.
async function measureSandbox(org: string, caseId: string) {
  type Interval = {
    seq: number;
    size: string;
    startedAt: string;
    endedAt: string | null;
    endReason: string | null;
  };
  type Log = { kind: string; at: string; data: { containerAt?: string } };
  // The case's close destroys the sandbox; a lost interval closes within
  // about three minutes, at its last heartbeat.
  let intervals: Interval[] = [];
  for (let attempt = 0; ; attempt++) {
    const read = await call<{ intervals: Interval[] }>(
      "GET",
      `/v1/orgs/${org}/cases/${caseId}/sandbox`,
    );
    if (read.status !== 200) fail(`reading the sandbox time: ${read.text}`);
    intervals = read.body.intervals;
    if (intervals.length && intervals.every((i) => i.endedAt)) break;
    if (attempt > 120)
      fail(`the sandbox interval never closed (last: ${read.text})`);
    await sleep(2000);
  }
  // Run logs reach the store through a queue.
  let logs: Log[] = [];
  for (let attempt = 0; ; attempt++) {
    const read = await call<{ logs: Log[] }>(
      "GET",
      `/v1/orgs/${org}/cases/${caseId}/logs?limit=500`,
    );
    logs = (read.body?.logs ?? []).filter((l) => l.kind.startsWith("sandbox."));
    const stops = logs.filter((l) => l.kind === "sandbox.stop").length;
    if (stops >= intervals.length) break;
    if (attempt > 60) break;
    await sleep(5000);
  }
  const containerAt = (kind: string) =>
    logs
      .filter((l) => l.kind === kind)
      .map((l) => l.data.containerAt)
      .filter((at): at is string => !!at)
      .sort();
  const starts = containerAt("sandbox.start");
  const stops = containerAt("sandbox.stop");
  const ms = (at: string | null | undefined) => (at ? Date.parse(at) : NaN);
  const seconds = (n: number) =>
    Number.isNaN(n) ? "n/a" : (n / 1000).toFixed(3);
  const rows = intervals.map((interval, i) => {
    const start = starts[i];
    const stop = stops[i];
    const billed = ms(interval.endedAt) - ms(interval.startedAt);
    const ran = ms(stop) - ms(start);
    return [
      String(interval.seq),
      interval.size,
      start ?? "not logged",
      interval.startedAt,
      seconds(ms(interval.startedAt) - ms(start)),
      stop ?? "not logged",
      interval.endedAt ?? "open",
      seconds(ms(stop) - ms(interval.endedAt)),
      interval.endReason ?? "",
      seconds(ran),
      seconds(billed),
      seconds(ran - billed),
    ];
  });
  const header = [
    "Interval",
    "Size",
    "Container start (log)",
    "started_at",
    "Start lag (s)",
    "Container stop (log)",
    "ended_at",
    "Stop gap (s)",
    "End",
    "Container (s)",
    "Billed (s)",
    "Under-billed (s)",
  ];
  const table = [header, header.map(() => "---"), ...rows]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
  const report = `### Sandbox time on ${stage}\n\nCase \`${caseId}\`. Under-billed is container time minus billed time; negative means the interval billed more than the container ran.\n\n${table}\n`;
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  if (!starts.length || !stops.length)
    fail("the sandbox's start and stop never reached the run log");
}

// The custom environment as this run saw it: its size, the deploy's wait for
// the build, the mount the sandbox logged, and whether the case's first
// command found the package and the file the setup put there.
async function reportLayer(
  org: string,
  caseId: string,
  deploymentId: string,
  bytes: number,
  readySeconds: number,
) {
  type Log = { kind: string; data: { mountMs?: number } };
  let mountMs: number | undefined;
  for (let attempt = 0; attempt <= 24; attempt++) {
    const read = await call<{ logs: Log[] }>(
      "GET",
      `/v1/orgs/${org}/cases/${caseId}/logs?limit=500`,
    );
    mountMs = (read.body?.logs ?? []).find((l) => l.kind === "sandbox.mount")
      ?.data.mountMs;
    if (mountMs !== undefined) break;
    await sleep(5000);
  }
  const room = await call("GET", `/v1/orgs/${org}/cases/${caseId}/room`);
  if (room.status !== 200) fail(`reading the case room: ${room.text}`);
  const sawPackage = /tree v\d/.test(room.text);
  const sawFile = room.text.includes("layer file present");
  const header = [
    "Deployment",
    "Layer (KB)",
    "Deploy to ready (s)",
    "Mount (s)",
    "Package (tree)",
    "File",
  ];
  const row = [
    `\`${deploymentId}\``,
    (bytes / 1024).toFixed(1),
    readySeconds.toFixed(1),
    mountMs === undefined ? "not logged" : (mountMs / 1000).toFixed(3),
    sawPackage ? "found" : "missing",
    sawFile ? "found" : "missing",
  ];
  const table = [header, header.map(() => "---"), row]
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n");
  const report = `### Custom environment on ${stage}\n\nCase \`${caseId}\`. Deploy to ready is the deploy request to the layer's build finishing, polled every 2 s. Mount is R2 download plus mount, as the sandbox logged it.\n\n${table}\n`;
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  if (mountMs === undefined) fail("the mount never reached the run log");
  if (!sawPackage || !sawFile)
    fail("the case's command did not see the custom environment");
}
