import type { Counter } from "./counter.ts";
import type { Namespace } from "./namespace.ts";
import type { OutboxMessage } from "./outbox.ts";

export type Job = { organizationId: string; id: string; requestedAt: string };

// Re-delivers an agent's secrets to its live scripts after a value or grant
// changes (design doc 03). Retried with backoff until it succeeds.
export type SecretSync = {
  kind: "secret.sync";
  organizationId: string;
  agentId: string;
};

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
  script: string;
  network: { allow: string[]; block: string[] };
  input: {
    text: string;
    files?: { id: string; name: string; contentType: string }[];
  };
  groups?: GroupRef[];
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
  rerun(c: CaseKey & { notes?: unknown[] }): Promise<CaseRoomState>;
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
  manifest(
    deployment: Omit<StartCase, "caseId" | "input" | "groups">,
  ): Promise<unknown>;
  getCase(c: CaseKey): Promise<unknown>;
};

export type Env = {
  STAGE: string;
  // Set on our cloud, unset on a self-hosted install; read it through
  // @preprocess/runmode.
  PREPROCESS_REGION?: string;
  USER_WORKER: string;
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
  JOBS: Queue<Job>;
  // Case starts from the outbox (outbox.ts).
  CASES: Queue<OutboxMessage>;
  SECRET_SYNC: Queue<SecretSync>;
  FILES: R2Bucket;
  RUNTIME: Runtime;
  // apps/pdf-render: PDF pages to PNGs in a sandbox container. Bound locally;
  // the deployed stack does not run it yet.
  PDF_RENDER?: { renderPdf(pdf: Uint8Array): Promise<Uint8Array[]> };
  // 32 random bytes, base64: Secrets Store on our cloud, a local variable in
  // development and tests. Only this Worker binds it (design doc 01).
  SECRETS_MASTER_KEY: string | SecretsStoreSecret;
  // Deploys upload into the stage's dispatch namespace through Cloudflare's
  // API. Locally, apps/namespace-local takes the same calls instead.
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  DISPATCH_NAMESPACE?: string;
  LOCAL_NAMESPACE?: Namespace;
  // Deployed stages bind the stage's dispatch namespace. Cloudflare's local
  // runtime cannot emulate one, so local dev binds the user Worker directly.
  DISPATCHER?: DispatchNamespace;
  LOCAL_USER_WORKER?: Fetcher;
};
