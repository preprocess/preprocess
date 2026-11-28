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
// - "selfhost" or "selfhost-<name>": a customer's install in their own
//   Cloudflare account (spec 16), on their own Postgres (DATABASE_URL). It
//   binds no PREPROCESS_REGION, so it runs in self-hosted mode.
// - "development": local only (`pnpm dev`), never deployed.

export const compatibility = {
  date: "2026-07-26",
  flags: ["nodejs_compat"],
};

export const LOCAL = "development";

export type SelfHostStage = "selfhost" | `selfhost-${string}`;

export type Stage = "staging" | "production" | `pr-${number}` | SelfHostStage;

export const isPreviewStage = (stage: string): stage is `pr-${number}` =>
  /^pr-\d+$/.test(stage);

export const isSelfHostStage = (stage: string): stage is SelfHostStage =>
  /^selfhost(-[a-z0-9]+(-[a-z0-9]+)*)?$/.test(stage);

export const isStage = (stage: string): stage is Stage =>
  stage === "staging" ||
  stage === "production" ||
  isPreviewStage(stage) ||
  isSelfHostStage(stage);

// The queues whose consumers move failed messages to a dead-letter queue,
// bound to the API as <QUEUE>_DLQ.
export const deadLetterQueues = [
  "jobs",
  "cases",
  "webhooks",
  "emails",
  "logs",
] as const;

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
  // Each queue's dead letters: messages its consumer failed on every retry,
  // held for 14 days. Nothing consumes them; the API's minute cron reports
  // their depth (apps/api/src/dead-letters.ts).
  deadLetters: (queue: (typeof deadLetterQueues)[number]) =>
    `preprocess-dlq-${queue}-${stage}`,
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

// The registry repositories the container images publish to, one per image
// and shared by every stage in the account (PRE-90). Images are tagged by the
// hash of their build inputs, so a stage whose inputs match another's reuses
// its image instead of building and pushing a new one.
export const imageRepositories = {
  build: "preprocess-buildimage",
  render: "preprocess-renderimage",
  "sandbox-standard": "preprocess-sandbox-standard",
  "sandbox-node": "preprocess-sandbox-node",
  "sandbox-python": "preprocess-sandbox-python",
  "sandbox-python-data": "preprocess-sandbox-python-data",
} as const;

// Model providers' keys (packages/models endpoints), optional on every stage:
// the runtime calls Baseten for the agent models and decide, the API calls
// Mistral for OCR. MODEL_ENDPOINTS is an install's own per-model endpoints,
// with their keys, so it is a secret too. Qwen needs no key: it runs on the
// runtime's Workers AI binding in the stage's own account.
export const runtimeModelSecrets = [
  "BASETEN_API_KEY",
  "MODEL_ENDPOINTS",
] as const;
export const apiModelSecrets = ["MISTRAL_API_KEY", "MODEL_ENDPOINTS"] as const;

// Whether a stage calls real model providers at all. Production and
// self-hosted installs do. Previews never do, and staging only when its deploy
// sets REAL_MODELS=true (the "Deploy" workflow's manual real_models input).
// Otherwise the stage gets no provider keys, no MODEL_ENDPOINTS and no Workers
// AI binding, so every agent model, decide and OCR call goes to the stub.
export const callsRealModels = (stage: Stage, realModels: boolean) =>
  stage === "production" ||
  isSelfHostStage(stage) ||
  (stage === "staging" && realModels);

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

// Google sign-in, optional on every stage: without both, sign-in is by emailed
// link only. Previews stay without them, since each preview's origin would
// need its own registered callback. The app reads the client id only to show
// the button.
export const googleVars = ["GOOGLE_CLIENT_ID"] as const;
export const googleSecrets = ["GOOGLE_CLIENT_SECRET"] as const;

// Autumn, our cloud's billing (spec 16a), optional: without it billing is off.
// Never bound on a self-hosted install, which bills nothing.
// AUTUMN_WEBHOOK_SECRET verifies Autumn's webhooks (Svix, whsec_…); without
// it the API's Autumn webhook answers 404.
export const billingSecrets = [
  "AUTUMN_SECRET_KEY",
  "AUTUMN_WEBHOOK_SECRET",
] as const;
// When cards became required, and our own organizations (apps/api/src/env.ts).
// Both unset, an organization without a plan is not limited.
// BILLING_ENFORCED_ORGS: organizations billed like customers before the date,
// such as a test organization in production.
export const billingVars = [
  "BILLING_REQUIRED_FROM",
  "BILLING_INTERNAL_ORGS",
  "BILLING_ENFORCED_ORGS",
] as const;

// Per stage, the organizations that are ours and the ones billed early, in
// code rather than the deploy environment. Neither is secret. Each list
// replaces its variable on that stage.
export const billingOrgs: Partial<
  Record<Stage, { internal: string[]; enforced: string[] }>
> = {
  // Both of our production organizations (Chip, 2026-11-26).
  production: {
    internal: [
      "org_01m8ar0hemfahb99w1a60fp0a7",
      "org_01m8aqtaf5eh1b069gww7vp2cf",
    ],
    enforced: [],
  },
  // The smoke-test organization, so the smoke test can deploy a custom
  // sandbox environment (custom_sandbox_images) on every staging deploy.
  staging: {
    internal: ["org_01m88msncpeczr044nncg2gr1j"],
    enforced: [],
  },
};
// The addresses our test runs sign up with, comma-separated, `*` for any
// characters before the @ (apps/api/src/analytics.ts): PostHog marks
// everything they and their organizations do test=true. Optional and on our
// cloud only, set by the deploy environment; unset, nothing is marked.
export const analyticsVars = ["ANALYTICS_TEST_EMAILS"] as const;
// The license key (spec 16), optional and on selfhost stages only: without a
// valid one the install runs the free plan. Our cloud never binds it.
export const licenseSecrets = ["PREPROCESS_LICENSE_KEY"] as const;

// The training switch (design doc 10), optional and on selfhost stages only:
// "on" turns Training on, and unset leaves it off. Our cloud never binds it;
// Training is always on there.
export const trainingVars = ["TRAINING_SERVICE"] as const;

// The status page heartbeat (apps/api/src/heartbeat.ts), optional and on our
// cloud only: the API posts to the URL with the secret as its bearer token.
// Without both, nothing is sent. Never bound on a self-hosted install.
export const statusHeartbeatVars = ["STATUS_HEARTBEAT_URL"] as const;
export const statusHeartbeatSecrets = ["STATUS_HEARTBEAT_SECRET"] as const;

// PostHog (spec 12 and 15): server errors and request events from the app,
// docs, API and runtime, and the app's browser errors. Production and staging
// each send to their own PostHog project, so staging never reaches
// production's; the keys are public project keys (phc_), the same ones
// browsers receive. Previews send nothing. A self-hosted
// install sends nothing unless its deploy sets POSTHOG_KEY, and POSTHOG_HOST
// for a host other than PostHog's US cloud, to point at its own PostHog.
export const posthogVars = ["POSTHOG_KEY", "POSTHOG_HOST"] as const;
export const posthogProject: Partial<
  Record<Stage, Record<(typeof posthogVars)[number], string>>
> = {
  production: {
    POSTHOG_KEY: "phc_AU5GoFmdkBQ8bxX6wvEbpneNhQbbVSayfzNCxa6RauJu",
    POSTHOG_HOST: "https://us.i.posthog.com",
  },
  staging: {
    POSTHOG_KEY: "phc_urwmiA4mz5QA3Dhu3WWxW8hmhPiK9qnFLHwtgpnA9uBq",
    POSTHOG_HOST: "https://us.i.posthog.com",
  },
};

// Deleting an organization (PRE-162) removes its run logs from the NDJSON store
// in the logs bucket only. Rows in the Iceberg table that LOG_CATALOG_TOKEN
// turns on (LOG_STORE "sql") can't be deleted from a Worker, and no job
// outside Workers deletes them yet, so a deploy with the token is refused
// until one exists and this becomes true.
export const icebergLogDeletion = false;
export const refuseIcebergLogs = (catalogTokenSet: boolean) =>
  catalogTokenSet && !icebergLogDeletion
    ? "LOG_CATALOG_TOKEN turns on Iceberg run logs, which deleting an organization can't remove yet (PRE-162). Unset it, or build the Iceberg log deletion job first."
    : null;

// Deleting an organization deletes the PostHog persons of members left in no
// organization (apps/api/src/purge.ts), with a personal API key scoped to
// person:write and the project's id. Optional on every stage: unset, persons
// stay in PostHog.
export const posthogPersonVars = ["POSTHOG_PROJECT_ID"] as const;
export const posthogPersonSecrets = ["POSTHOG_PERSONAL_API_KEY"] as const;

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
  // Rate limits: one per organization, API key and client address.
  RATE_LIMITER: "RateLimiter",
} as const;

// Durable Object classes the runtime Worker exports: one Pi Durable case
// runtime per organization, agent and case.
export const runtimeDurableObjects = { CASE_RUNTIME: "CaseRuntime" } as const;

// Case sandboxes (spec 3): one class per size, each starting its own instance
// type (apps/runtime/src/sandbox.ts), all from the same preset images.
export const sandboxDurableObjects = {
  SANDBOX_SMALL: "SandboxSmall",
  SANDBOX_MEDIUM: "SandboxMedium",
  SANDBOX_LARGE: "SandboxLarge",
} as const;

// The sandbox images: each preset builds from apps/runtime/sandbox/Dockerfile
// with PRESET naming its stage. The keys are the images' names in
// ctx.container.images.
export const sandboxImages = {
  SandboxStandard: "standard",
  SandboxNode: "node",
  SandboxPython: "python",
  SandboxPythonData: "python-data",
} as const;

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

// The public docs site, linked from the app wherever a stage has no docs
// domain of its own.
export const publicDocsUrl = "https://docs.preprocess.com";

// Our public status page, linked from the app and docs on our own stages only;
// a self-hosted install has no status page of ours (spec 16).
export const publicStatusUrl = "https://status.preprocess.com";

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
