// Every stage, name, binding and secret the stack uses. alchemy.run.ts deploys
// from this file, and scripts/wrangler-config.ts writes each app's
// wrangler.jsonc from it for local development, so local and deployed names
// never drift.
//
// Stages:
// - "staging": our shared test cloud, deployed from every push to main.
// - "production": deployed from a commit that passed staging. Its hostname
//   and credentials come from the deploy environment (APP_DOMAIN and the
//   rest), so our cloud's production configuration stays private.
// - "pr-<number>": one per pull request, fully isolated (spec 16c).
// - "development": local only (`pnpm dev`), never deployed.

export const compatibility = {
  date: "2026-07-26",
  flags: ["nodejs_compat"],
};

export const LOCAL = "development";

export type Stage = "staging" | "production" | `pr-${number}`;

export const isPreviewStage = (stage: string): stage is `pr-${number}` =>
  /^pr-\d+$/.test(stage);

export const isStage = (stage: string): stage is Stage =>
  stage === "staging" || stage === "production" || isPreviewStage(stage);

export const names = (stage: string) => ({
  app: `preprocess-app-${stage}`,
  // The docs site (apps/docs).
  docs: `preprocess-docs-${stage}`,
  api: `preprocess-api-${stage}`,
  queue: `preprocess-jobs-${stage}`,
  // Case starts (design doc 04): the API enqueues after commit and consumes.
  casesQueue: `preprocess-cases-${stage}`,
  // Webhook deliveries (design doc 06), retried with backoff for 24 hours.
  webhooksQueue: `preprocess-webhooks-${stage}`,
  // Notification emails (design doc 06) and the keys already sent, for a day.
  emailsQueue: `preprocess-emails-${stage}`,
  emailsSent: `preprocess-emails-sent-${stage}`,
  // Run logs (design doc 09): every producer's records, consumed by the API.
  logsQueue: `preprocess-logs-${stage}`,
  logs: `preprocess-logs-${stage}`,
  bucket: `preprocess-files-${stage}`,
  auditBucket: `preprocess-audit-${stage}`,
  runtime: `preprocess-runtime-${stage}`,
  // The GitHub build sandbox (apps/builder).
  builder: `preprocess-builder-${stage}`,
  // Agent code (design doc 03): each deployment's bundle, which the runtime
  // loads as a Dynamic Worker.
  bundles: `preprocess-bundles-${stage}`,
  // The Tail Worker on agent code (design doc 09).
  tail: `preprocess-tail-${stage}`,
  modelStub: `preprocess-model-stub-${stage}`,
  // PDF pages to images for OCR, in a sandbox container (design doc 07).
  pdfRender: `preprocess-pdf-render-${stage}`,
  runs: `preprocess-runs-${stage}`,
  // The API's SECRETS_MASTER_KEY in the account's Secrets Store, whose names
  // allow letters, digits and underscores only.
  secretsMasterKey: `preprocess_secrets_master_key_${stage.replace(/\W/g, "_")}`,
  branch: stage,
});

// The API's secrets, read from the deploy environment and bound as
// secret_text. Locally `pnpm dev` writes generated values to apps/api/.dev.vars.
export const apiSecrets = ["BETTER_AUTH_SECRET", "AUDIT_SIGNING_KEY"] as const;

// The GitHub App's credentials (docs/design/08-github-app.md), optional on
// every stage: without them the App's routes answer 503.
export const githubVars = [
  "GITHUB_APP_ID",
  "GITHUB_APP_SLUG",
  "GITHUB_CLIENT_ID",
] as const;
export const githubSecrets = [
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_CLIENT_SECRET",
] as const;

// 00:20 UTC daily: the signed copy of yesterday's audit chain (doc 02).
// Every minute: re-send outbox rows a failed queue send left behind (doc 04).
export const apiCrons = ["20 0 * * *", "* * * * *"];

// Durable Object classes the API Worker exports.
export const durableObjects = {
  COUNTER: "Counter",
  // One per organization, agent and branch: GitHub builds run one at a time.
  BUILDS: "BuildQueue",
  // One per organization and agent, and one per preview deployment with
  // schedules (design doc 04).
  SCHEDULER: "Scheduler",
} as const;

// Durable Object classes the runtime Worker exports: one Pi Durable case
// runtime per organization, agent and case.
export const runtimeDurableObjects = { CASE_RUNTIME: "CaseRuntime" } as const;

// Locally the API calls apps/model-stub through its portless URL, the same
// code path as a real model service. The stub accepts any bearer token.
export const localModelService = {
  url: "https://model-stub.preprocess.localhost",
  key: "development",
};

export const localDatabaseUrl =
  "postgresql://preprocess:preprocess@127.0.0.1:5432/preprocess_development";

// The API's two Postgres roles on the local server (packages/db/README.md).
// These passwords exist only locally.
export const localRoleDatabaseUrl = (
  role: "preprocess_app" | "preprocess_system",
) => {
  const url = new URL(localDatabaseUrl);
  url.username = role;
  url.password = role;
  return url.href;
};

// The app's local origin. It serves Better Auth and /v1 from the API Worker,
// so cookies stay first-party.
export const localAppUrl = "https://app.preprocess.localhost";

// The GitHub App in `pnpm dev`: scripts/github-stub.ts stands in for GitHub
// and apps/builder/local/server.ts runs the build sandbox under Docker. The
// private key, webhook secret and client secret are generated into
// apps/api/.dev.vars.
export const localGitHub = {
  appId: "1",
  appSlug: "preprocess-development",
  clientId: "Iv1.development",
  url: "http://127.0.0.1:8791",
  builder: "http://127.0.0.1:8789",
};
export const localEmailFrom = "Preprocess <invitations@preprocess.localhost>";
export const localAuditKeyId = "audit-ed25519-development";

// values typed into a local database. Deployed stages bind Secrets Store.
export const localSecretsMasterKey =
  "cHJlcHJvY2Vzcy1sb2NhbC1tYXN0ZXIta2V5LTMyYnk=";
