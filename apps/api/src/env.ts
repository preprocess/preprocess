import type { LogRecord, PostHogEnv, ProductEvent } from "@preprocess/logs";
import type { SandboxOwner } from "@preprocess/sandbox";
import type { NetworkRules } from "@preprocess/db/schema/deployments";
import type { SandboxPreset, SandboxSetup } from "@preprocess/sdk/protocol";
import type { Pipeline } from "cloudflare:pipelines";

import type { BuildQueue } from "./builds.ts";
import type { Counter } from "./counter.ts";
import type { RateLimiter } from "./rate-limit.ts";
import type { Scheduler } from "./scheduler.ts";
import type { OtelRetry } from "./otel.ts";
import type { OutboxMessage } from "./outbox.ts";
import type { EffectiveSettings } from "./settings.ts";

export type Job = { organizationId: string; id: string; requestedAt: string };

type CaseKey = { organizationId: string; agentId: string; caseId: string };
type Edit = CaseKey & { path: string; version: number; userId: string };

export type GroupRef = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  access: "operator" | "viewer" | "developers";
};

export type StartCase = CaseKey & {
  deploymentId: string;
  bundleHash: string;
  network: { allow: string[]; block: string[] };
  // The agent's settings after dashboard overrides and organization defaults
  // (spec 5), applied over the manifest's.
  settings?: EffectiveSettings;
  input: {
    text: string;
    files?: { id: string; name: string; contentType: string }[];
  };
  groups?: GroupRef[];
  // The agent's accepted memory rules (spec 10); an eval run's own snapshot.
  memories?: { id: string; text: string }[];
  // An eval case (design doc 09): a replay of a suite case's source case.
  eval?: { runId: string; sourceCaseId: string; captureKey: string };
};

// apps/runtime's default entrypoint. Answers and
// capture carry arbitrary JSON, so results are read loosely here.
export type WriteResult =
  | {
      result: "ok" | "suggested";
      path: string;
      before?: unknown;
      after?: unknown;
      stale?: string[];
    }
  | { result: "refused"; path: string; reason: string }
  | { result: "conflict"; path: string; version: number };

// apps/runtime's capture.ts, version 1. Events carry arbitrary JSON.
export type RunCapture = {
  format: "preprocess.run";
  version: 1;
  organizationId: string;
  agentId: string;
  deploymentId: string;
  caseId: string;
  sdkVersion: string;
  model: string;
  status: "completed" | "failed";
  usage: {
    input: number;
    output: number;
    costMicroUsd: number;
    charges: { model: number; decide: number; ocr: number };
  };
  events: {
    seq: number;
    at: string;
    kind: string;
    data: Record<string, unknown>;
  }[];
};

export type CaseRoomState = {
  status: string;
  run: number;
  answers: Record<string, unknown> | null;
  checks: { name: string; ok: boolean; field?: string; message?: string }[];
  [key: string]: unknown;
};

export type Runtime = {
  startCase(start: StartCase): Promise<unknown>;
  caseState(c: CaseKey): Promise<CaseRoomState>;
  rerun(
    c: CaseKey & {
      notes?: unknown[];
      memories?: { id: string; text: string }[];
    },
  ): Promise<CaseRoomState>;
  decideApproval(
    c: CaseKey & {
      id: string;
      approve: boolean;
      userId: string;
      note: string | null;
    },
  ): Promise<CaseRoomState>;
  editAnswer(
    c: Edit & { value: unknown },
  ): Promise<{ result: WriteResult; checks: CaseRoomState["checks"] }>;
  confirmAnswer(
    c: Edit,
  ): Promise<{ result: WriteResult; checks: CaseRoomState["checks"] }>;
  acceptSuggestion(
    c: Edit,
  ): Promise<{ result: WriteResult; checks: CaseRoomState["checks"] }>;
  searchOptions(
    c: CaseKey & {
      path: string;
      query?: string | undefined;
      cursor?: string | undefined;
      limit?: number | undefined;
    },
  ): Promise<unknown>;
  postMessage(
    c: CaseKey & { userId: string; text: string },
  ): Promise<{ id: string; mentioned: string[]; first: boolean }>;
  cancelCase(c: CaseKey): Promise<CaseRoomState>;
  // A closed case's run capture (format preprocess.run), or null when none
  // is stored (design doc 10).
  readCapture(c: CaseKey): Promise<RunCapture | null>;
  // Retention (spec 16a): a closed case's run capture, or all of its state.
  deleteCapture(c: CaseKey): Promise<void>;
  deleteCase(c: CaseKey): Promise<void>;
  completeCase(
    c: CaseKey,
  ): Promise<
    | { result: "ok"; state: CaseRoomState }
    | { result: "refused"; code: string; message: string }
  >;
  manifest(
    deployment: Omit<StartCase, "caseId" | "input" | "groups">,
  ): Promise<unknown>;
  // Stores a new deployment's bundle where the runtime loads it as a Dynamic
  // Worker (design doc 03) and returns its SHA-256.
  putBundle(
    deployment: {
      organizationId: string;
      agentId: string;
      deploymentId: string;
    },
    bundle: { mainModule: string; modules: Record<string, string> },
  ): Promise<string>;
  getCase(c: CaseKey): Promise<unknown>;
  // Custom environments (spec 3): a deploy's layer build, whose result comes
  // back through Platform.sandboxLayerBuilt, and a collected layer's delete.
  queueSandboxLayer(
    job: SandboxLayerJob,
    deployment: {
      organizationId: string;
      agentId: string;
      deploymentId: string;
    },
  ): Promise<void>;
  deleteSandboxLayer(organizationId: string, key: string): Promise<boolean>;
};

export type SandboxLayerJob = {
  organizationId: string;
  agentId: string;
  preset: SandboxPreset;
  setup: SandboxSetup;
  network: NetworkRules;
};

export type SandboxLayer = {
  key: string;
  image: string;
  bytes: number;
  unpackedBytes: number;
};

export type SandboxLayerResult = SandboxLayer | { error: string; log?: string };

// apps/builder's Builder entrypoint: builds a commit's tarball in a sandbox
// with the project's own package manager and the CLI's bundle(). It never
// receives a credential.
export type BuildRequest = {
  id: string;
  archive: ReadableStream<Uint8Array>;
  directory: string;
  entry: string;
  timeoutSeconds: number;
  // Whose build it is, for sandbox metering (sandbox.ts).
  owner: SandboxOwner;
};

export type BuildResult =
  | {
      status: "succeeded";
      bundle: { mainModule: string; modules: Record<string, string> };
      log: string;
    }
  | { status: "failed" | "timed_out"; log: string };

export type Builder = {
  build(request: BuildRequest): Promise<BuildResult>;
  cancel(id: string): Promise<void>;
};

// POSTHOG_KEY and POSTHOG_HOST (@preprocess/logs posthog.ts): set on our
// production and on a self-hosted install that names its own PostHog.
export type Env = PostHogEnv & {
  STAGE: string;
  // Set on our cloud, unset on a self-hosted install; read it through
  // @preprocess/runmode.
  PREPROCESS_REGION?: string;
  // Autumn (spec 16a): our cloud's billing. Unset, billing is off: nothing is
  // reported and every organization is on the free plan without limits.
  AUTUMN_SECRET_KEY?: string;
  // Verifies Autumn's webhooks (Svix, whsec_…). Unset, the Autumn webhook
  // answers 404 and auto-reload failures aren't recorded.
  AUTUMN_WEBHOOK_SECRET?: string;
  // When cards became required (an ISO date; spec 16a). Unset, an
  // organization without a plan is not limited. Set, organizations created
  // before it are put on Free without a card, and later ones must start a
  // plan at checkout once the date has passed.
  BILLING_REQUIRED_FROM?: string;
  // Preprocess's own organizations, comma-separated ids: the internal plan.
  BILLING_INTERNAL_ORGS?: string;
  // Organizations billed like customers now, whatever BILLING_REQUIRED_FROM
  // says, comma-separated ids: a test organization before go-live.
  BILLING_ENFORCED_ORGS?: string;
  // Self-hosted only: the signed license key (license.ts). Without a valid
  // one the install runs the free plan.
  PREPROCESS_LICENSE_KEY?: string;
  // Self-hosted only: "on" turns Training on (training.ts). Our cloud ignores
  // it.
  TRAINING_SERVICE?: string;
  // Our cloud only: where the API posts its heartbeat (heartbeat.ts) and the
  // bearer token it sends. Unset, as on a self-hosted install, nothing is sent.
  STATUS_HEARTBEAT_URL?: string;
  STATUS_HEARTBEAT_SECRET?: string;
  // Where OCR is served (@preprocess/models endpoints): Mistral, an
  // install's own MODEL_ENDPOINTS entry, or MODEL_SERVICE_URL (the stub).
  MISTRAL_API_KEY?: string;
  MODEL_ENDPOINTS?: string;
  MODEL_SERVICE_URL?: string;
  MODEL_SERVICE_KEY?: string;
  // Postgres as preprocess_app (RLS enforced) and as preprocess_system (RLS
  // bypassed, Better Auth and withoutOrg only). Both Hyperdrive configs have
  // query caching off (PLAT-27).
  DB: Hyperdrive;
  DB_SYSTEM: Hyperdrive;
  // The app's public origin: Better Auth's base URL and the host of links in
  // emails. The app serves /api/auth/* and /v1/* from this Worker.
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  EMAIL: SendEmail;
  EMAIL_FROM: string;
  // The daily signed audit manifests (doc 02): their own bucket, locked for a
  // year on deployed stages.
  AUDIT: R2Bucket;
  // Ed25519 private key, PKCS #8 in base64, and its id.
  AUDIT_SIGNING_KEY: string;
  AUDIT_SIGNING_KEY_ID: string;
  COUNTER: DurableObjectNamespace<Counter>;
  // Rate limits (rate-limit.ts): one object per organization, API key and
  // client address.
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  // Schedules (scheduler.ts): one object per agent, and one per preview.
  SCHEDULER: DurableObjectNamespace<Scheduler>;
  JOBS: Queue<Job>;
  // Case starts from the outbox (outbox.ts).
  CASES: Queue<OutboxMessage>;
  // Webhook deliveries from the outbox (webhooks.ts).
  WEBHOOKS: Queue<OutboxMessage>;
  // Notification emails from the outbox (notify.ts), and the keys already
  // sent, kept for a day.
  EMAILS: Queue<OutboxMessage>;
  EMAILS_SENT: KVNamespace;
  FILES: R2Bucket;
  RUNTIME: Runtime;
  // apps/pdf-render: PDF pages to PNGs in a sandbox container.
  PDF_RENDER?: {
    renderPdf(pdf: Uint8Array, owner: SandboxOwner): Promise<Uint8Array[]>;
  };
  // 32 random bytes, base64: Secrets Store on our cloud, a local variable in
  // development and tests. Only this Worker binds it (design doc 01).
  SECRETS_MASTER_KEY: string | SecretsStoreSecret;
  // The GitHub App (docs/design/08-github-app.md). Without these its routes
  // answer 503. The private key is the App's key converted to PKCS #8 PEM.
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  // Google sign-in. Without both, the app shows only the emailed link.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Default https://api.github.com and https://github.com; the local GitHub
  // stub in development.
  GITHUB_API_URL?: string;
  GITHUB_URL?: string;
  // Wall-clock limit for one build, in seconds (default 600).
  GITHUB_BUILD_TIMEOUT_SECONDS?: string;
  BUILDS: DurableObjectNamespace<BuildQueue>;
  BUILDER?: Builder;
  // Run logs (design doc 09). Every producer's records go through LOGS; its
  // consumer writes the store and the Postgres summaries. LOG_STORE "sql" is
  // the Pipelines stream plus R2 SQL on deployed stages; anything else keeps
  // NDJSON in LOG_BUCKET, which is how local development and tests run.
  // Product analytics events (analytics.ts) ride it to PostHog too.
  LOGS: Queue<LogRecord | OtelRetry | { product: ProductEvent }>;
  // Each queue's dead letters (dead-letters.ts), read only for their depth.
  // Deployed stages bind them; local development and tests do not.
  JOBS_DLQ?: Queue;
  CASES_DLQ?: Queue;
  WEBHOOKS_DLQ?: Queue;
  EMAILS_DLQ?: Queue;
  LOGS_DLQ?: Queue;
  LOG_BUCKET: R2Bucket;
  LOG_STORE?: string;
  LOG_STREAM?: Pipeline;
  // The account, the R2 bucket holding the Data Catalog warehouse, and a
  // token with R2 SQL read, Data Catalog and R2 storage access.
  CLOUDFLARE_ACCOUNT_ID?: string;
  LOG_SQL_BUCKET?: string;
  LOG_SQL_TOKEN?: string;
};
