import type { Counter } from "./counter.ts";
import type { Namespace } from "./namespace.ts";

export type Job = { organizationId: string; id: string; requestedAt: string };

// Re-delivers an agent's secrets to its live scripts after a value or grant
// changes (design doc 03). Retried with backoff until it succeeds.
export type SecretSync = {
  kind: "secret.sync";
  organizationId: string;
  agentId: string;
};

type RuntimeDeployment = {
  organizationId: string;
  agentId: string;
  deploymentId: string;
  script: string;
  network: { allow: string[]; block: string[] };
};

// apps/runtime's default entrypoint.
export type Runtime = {
  manifest(deployment: RuntimeDeployment): Promise<unknown>;
  startCase(
    start: RuntimeDeployment & { caseId: string; input: { text: string } },
  ): Promise<unknown>;
  getCase(c: {
    organizationId: string;
    agentId: string;
    caseId: string;
  }): Promise<unknown>;
};

export type Env = {
  STAGE: string;
  // Set on our cloud, unset on a self-hosted install; read it through
  // @preprocess/runmode.
  PREPROCESS_REGION?: string;
  USER_WORKER: string;
  MODEL_SERVICE_URL?: string;
  MODEL_SERVICE_KEY?: string;
  DB: Hyperdrive;
  DB_SYSTEM: Hyperdrive;
  COUNTER: DurableObjectNamespace<Counter>;
  JOBS: Queue<Job>;
  SECRET_SYNC: Queue<SecretSync>;
  FILES: R2Bucket;
  RUNTIME: Runtime;
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
