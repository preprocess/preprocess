// One case per agent model on a deployed stage, each with the sample invoice
// attached so it is OCR'd, and each able to call decide (spec v1.7). For every
// case it prints the id, model, status, answers, and the tokens and charges
// its run capture recorded, read from the stage's runs bucket when Cloudflare
// credentials are set. It signs in as the smoke-test user the way
// scripts/smoke.ts does, after it. It never prints a key.
//
// MODELS=stub (the default) is the staging smoke test's model step: the stage
// calls no real provider, so the stub answers every agent model in its
// provider's chat-completions shape, decide in Baseten's System One shape and
// OCR in Mistral's. Every case must then follow the stub's ocr-invoice fixture
// (apps/model-stub/fixtures/chat.json), which only OCR'd invoice text
// triggers, get decide's picks back, fill the schema and be charged.
// MODELS=real is the full real-model pass the "Deploy" workflow runs only when
// started by hand with real_models; there each case only has to complete.

import { createHmac } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildSync } from "esbuild";

const { app } = JSON.parse(process.env.OUTPUTS ?? "{}") as { app?: string };
const stage = process.env.STAGE ?? "staging";
const authSecret = process.env.BETTER_AUTH_SECRET;
const emailFrom = process.env.EMAIL_FROM;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const real = process.env.MODELS === "real";
if (!["stub", "real", undefined].includes(process.env.MODELS))
  throw new Error(`MODELS must be stub or real, not ${process.env.MODELS}`);
if (!app || !authSecret || !emailFrom)
  throw new Error("OUTPUTS, BETTER_AUTH_SECRET and EMAIL_FROM must be set");
const domain = /@([^>\s]+)>?\s*$/.exec(emailFrom)?.[1];
const email = `smoke-test+${stage}@${domain}`;
const tokenFor = (minute: number) =>
  createHmac("sha256", authSecret)
    .update(`smoke-test:${email}:${minute}`)
    .digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (what: string): never => {
  throw new Error(`model check failed: ${what}`);
};

const cookies = new Map<string, string>();
const call = async <T = unknown>(
  method: string,
  pathname: string,
  body?: unknown,
) => {
  const form = body instanceof FormData;
  const response = await fetch(new URL(pathname, app), {
    method,
    redirect: "manual",
    headers: {
      origin: new URL(app).origin,
      ...(cookies.size && {
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      }),
      ...(body !== undefined &&
        !form && { "content-type": "application/json" }),
    },
    ...(body !== undefined && {
      body: form ? body : JSON.stringify(body),
    }),
  });
  for (const header of response.headers.getSetCookie()) {
    const [pair = ""] = header.split(";");
    const at = pair.indexOf("=");
    if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, text, body: json as T };
};

await call("POST", "/api/auth/sign-in/magic-link", { email, callbackURL: "/" });
const minute = Math.floor(Date.now() / 60_000);
let user: { id: string } | undefined;
for (const at of [minute, minute - 1]) {
  await call(
    "GET",
    `/api/auth/magic-link/verify?${new URLSearchParams({ token: tokenFor(at), callbackURL: "/" }).toString()}`,
  );
  const session = await call<{ user?: { id: string } } | null>(
    "GET",
    "/api/auth/get-session",
  );
  user = session.body?.user;
  if (user) break;
}
if (!user) fail("signing in");
const orgs = await call<{ id: string; slug: string }[]>(
  "GET",
  "/api/auth/organization/list",
);
const org =
  orgs.body?.find((o) => o.slug.startsWith("smoke-test-"))?.id ??
  fail("no smoke-test organization; run the smoke test first");
const groups = await call<{ id: string; slug: string }[]>(
  "GET",
  `/v1/orgs/${org}/groups`,
);
const group =
  groups.body?.find((g) => g.slug === "smoke-operators")?.id ??
  fail("no smoke-operators group; run the smoke test first");

const models = [
  "kimi-k3.1-pro",
  "deepseek-v4.1-flash",
  "deepseek-v4.1-flash-fast",
  "qwen3.8-27b",
] as const;

const deploy = async (model: (typeof models)[number]) => {
  const slug = `check-${model.replace(/\W+/g, "-")}`;
  const built = buildSync({
    entryPoints: [
      path.join(import.meta.dirname, "../smoke-agent/check-agent.ts"),
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2023",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["module", "main"],
    external: ["cloudflare:*", "node:*"],
    define: { MODEL: JSON.stringify(model) },
    logLevel: "warning",
  });
  const deployed = await call<{ id: string; production: boolean }>(
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
  if (deployed.status !== 201) fail(`deploying ${slug}: ${deployed.text}`);
  if (!deployed.body.production)
    await call(
      "POST",
      `/v1/orgs/${org}/agents/${slug}/deployments/${deployed.body.id}/promote`,
    );
  const agent = await call<{ id: string }>(
    "GET",
    `/v1/orgs/${org}/agents/${slug}`,
  );
  await call("PUT", `/v1/orgs/${org}/agents/${agent.body.id}/grants/${group}`, {
    access: "operator",
  });
  return { slug, agentId: agent.body.id };
};

const invoice = readFileSync(
  path.join(
    import.meta.dirname,
    "../../apps/model-stub/fixtures/ocr/samples/acme-invoice.png",
  ),
);
// A case takes its files, so each case gets its own upload.
const upload = async () => {
  const form = new FormData();
  form.set(
    "file",
    new Blob([invoice], { type: "image/png" }),
    "acme-invoice.png",
  );
  const file = await call<{ id: string }>(
    "POST",
    `/v1/orgs/${org}/files`,
    form,
  );
  if (file.status !== 201) fail(`uploading the invoice: ${file.text}`);
  return file.body.id;
};

const capture = async (agentId: string, caseId: string) => {
  if (!account || !token) return null;
  const key = `${org}/agents/${agentId}/cases/${caseId}/run.v1.json`;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/preprocess-runs-${stage}/objects/${encodeURIComponent(key)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) return null;
  return (await response.json()) as {
    usage: unknown;
    events: { kind: string; data: Record<string, unknown> }[];
  };
};

let failed = false;
const rows: string[][] = [];
for (const model of models) {
  const { slug, agentId } = await deploy(model);
  const started = await call<{ id: string }>("POST", `/v1/orgs/${org}/cases`, {
    agent: slug,
    text: `Model check of ${model}: the invoice is attached.`,
    files: [await upload()],
  });
  if (started.status !== 202) fail(`starting ${slug}: ${started.text}`);
  const id = started.body.id;
  let state: { status?: string; costUsd?: number } = {};
  for (let attempt = 0; attempt < 90; attempt++) {
    state = (await call<typeof state>("GET", `/v1/orgs/${org}/cases/${id}`))
      .body;
    if (
      ["completed", "failed", "cancelled", "halted"].includes(
        state.status ?? "",
      )
    )
      break;
    await sleep(2000);
  }
  const room = await call<{
    answers: Record<string, unknown> | null;
    thread: { kind: string; text: string }[];
  }>("GET", `/v1/orgs/${org}/cases/${id}/room`);
  const run = await capture(agentId, id);
  const responses = (run?.events ?? []).filter(
    (e) => e.kind === "model.response",
  );
  console.log(
    JSON.stringify(
      {
        case: id,
        model,
        status: state.status,
        costUsd: state.costUsd,
        answers: room.body?.answers ?? null,
        usage: run?.usage ?? "capture not stored yet",
        servedBy: [
          ...new Set(
            responses.map(
              (e) =>
                (e.data.message as { responseModel?: string } | undefined)
                  ?.responseModel ?? model,
            ),
          ),
        ],
        decide: (run?.events ?? [])
          .filter((e) => e.kind === "decide")
          .map((e) => ({
            picks: e.data.picks,
            usage: e.data.usage,
            costMicroUsd: e.data.costMicroUsd,
          })),
        ocr: (run?.events ?? [])
          .filter((e) => e.kind === "ocr")
          .map((e) => ({
            pages: e.data.pages,
            costMicroUsd: e.data.costMicroUsd,
          })),
        errors: (run?.events ?? [])
          .filter((e) => e.kind === "model.error")
          .map((e) => e.data.error),
      },
      null,
      2,
    ),
  );
  const reply = (room.body?.thread ?? [])
    .filter((m) => m.kind === "agent")
    .map((m) => m.text)
    .join("\n");
  const problems = [
    state.status !== "completed" && `ended ${state.status ?? "unknown"}`,
    !real &&
      !reply.includes("Read invoice 1042 from its OCR text.") &&
      "the stub did not answer from the OCR'd invoice",
    !real && !reply.includes('"picks"') && "decide returned no picks",
    !real &&
      room.body?.answers?.vendor !== "acme" &&
      "the schema has no vendor answer",
    !real && !(Number(state.costUsd) > 0) && "the case was not charged",
  ].filter((p): p is string => typeof p === "string");
  rows.push([
    model,
    `\`${id}\``,
    state.status ?? "unknown",
    String(state.costUsd ?? "n/a"),
    problems.length ? `FAIL: ${problems.join("; ")}` : "PASS",
  ]);
  if (problems.length) {
    console.error(`${model}: ${problems.join("; ")}`);
    failed = true;
  }
}
const table = [
  ["Model", "Case", "Status", "Charged (USD)", "Check"],
  Array(5).fill("---"),
  ...rows,
]
  .map((row) => `| ${row.join(" | ")} |`)
  .join("\n");
const report = `### ${real ? "Real-model pass" : "Models on the stub"} on ${stage}: ${failed ? "FAIL" : "PASS"}\n\n${real ? "Every agent model, decide and OCR on the real providers." : "Zero real provider calls: this stage binds no provider key and no Workers AI, so the stub served every agent model, decide and OCR call below."}\n\n${table}\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
if (failed) fail("a case failed its check; see above");
console.log("model check passed");
