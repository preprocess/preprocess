import type { Counter } from "./counter.ts";

export type Job = { organizationId: string; id: string; requestedAt: string };

export type Env = {
  STAGE: string;
  // Set on our cloud, unset on a self-hosted install; read it through
  // @preprocess/runmode.
  PREPROCESS_REGION?: string;
  USER_WORKER: string;
  MODEL_SERVICE_URL?: string;
  MODEL_SERVICE_KEY?: string;
  DB: Hyperdrive;
  COUNTER: DurableObjectNamespace<Counter>;
  JOBS: Queue<Job>;
  FILES: R2Bucket;
  // Deployed stages bind the stage's dispatch namespace. Cloudflare's local
  // runtime cannot emulate one, so local dev binds the user Worker directly.
  DISPATCHER?: DispatchNamespace;
  LOCAL_USER_WORKER?: Fetcher;
};
