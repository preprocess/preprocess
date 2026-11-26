import type { LogRecord } from "@preprocess/logs";
import type { Pipeline } from "cloudflare:pipelines";

import type { BuildQueue } from "./builds.ts";
import type { Counter } from "./counter.ts";
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
  ): Promise<{ id: string; mentioned: string[] }>;
  cancelCase(c: CaseKey): Promise<CaseRoomState>;
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
};

// apps/builder's Builder entrypoint: builds a commit's tarball in a sandbox
// with the project's own package manager and the CLI's bundle(). It never
// receives a credential.
export type BuildRequest = {
  id: string;
  archive: ReadableStream<Uint8Array>;
  directory: string;
  entry: string;
  timeoutSeconds: number;
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

export type Env = {
  STAGE: string;
  // Set on our cloud, unset on a self-hosted install; read it through
  // @preprocess/runmode.
  PREPROCESS_REGION?: string;
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
  PDF_RENDER?: { renderPdf(pdf: Uint8Array): Promise<Uint8Array[]> };
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
  LOGS: Queue<LogRecord | OtelRetry>;
  LOG_BUCKET: R2Bucket;
  LOG_STORE?: string;
  LOG_STREAM?: Pipeline;
  // The account, the R2 bucket holding the Data Catalog warehouse, and a
  // token with R2 SQL read, Data Catalog and R2 storage access.
  CLOUDFLARE_ACCOUNT_ID?: string;
  LOG_SQL_BUCKET?: string;
  LOG_SQL_TOKEN?: string;
};
