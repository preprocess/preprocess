import type { CaseRuntime } from "./case-runtime.ts";

export type Env = {
  STAGE: string;
  MODEL_SERVICE_URL?: string;
  MODEL_SERVICE_KEY?: string;
  CASE_RUNTIME: DurableObjectNamespace<CaseRuntime>;
  RUNS: R2Bucket;
  // Deployed stages bind the stage's dispatch namespace. Cloudflare's local
  // runtime cannot emulate one, so local dev and tests bind
  // apps/namespace-local instead.
  DISPATCHER?: DispatchNamespace;
  LOCAL_NAMESPACE?: Fetcher;
};

export type NetworkRules = { allow: string[]; block: string[] };

// What the runtime needs to know about the deployment a case runs on. The
// platform's deployment record supplies it; agent code never does.
export type Deployment = {
  organizationId: string;
  agentId: string;
  deploymentId: string;
  script: string;
  network: NetworkRules;
};

export type StartCase = Deployment & {
  caseId: string;
  input: { text: string };
};
