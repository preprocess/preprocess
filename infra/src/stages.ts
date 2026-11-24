// Every stage, name, binding and secret the stack uses. alchemy.run.ts deploys
// from this file, and scripts/wrangler-config.ts writes each app's
// wrangler.jsonc from it for local development, so local and deployed names
// never drift.
//
// Stages:
// - "staging": our shared test cloud. Today it deploys the app Worker only;
//   the backend joins it once its PlanetScale database exists. Production
//   deployment config for our cloud is private and lives elsewhere.
// - "pr-<number>": one per pull request, fully isolated (spec 16c).
// - "development": local only (`pnpm dev`), never deployed.

export const compatibility = {
  date: "2026-07-26",
  flags: ["nodejs_compat"],
};

export const LOCAL = "development";

export type Stage = "staging" | `pr-${number}`;

export const isPreviewStage = (stage: string): stage is `pr-${number}` =>
  /^pr-\d+$/.test(stage);

export const isStage = (stage: string): stage is Stage =>
  stage === "staging" || isPreviewStage(stage);

export const names = (stage: string) => ({
  app: `preprocess-app-${stage}`,
  api: `preprocess-api-${stage}`,
  namespace: `preprocess-${stage}`,
  queue: `preprocess-jobs-${stage}`,
  secretSync: `preprocess-secret-sync-${stage}`,
  bucket: `preprocess-files-${stage}`,
  userWorker: "hello",
  runtime: `preprocess-runtime-${stage}`,
  outbound: `preprocess-outbound-${stage}`,
  modelStub: `preprocess-model-stub-${stage}`,
  runs: `preprocess-runs-${stage}`,
  // Local only: stands in for the dispatch namespace, which Cloudflare's local
  // runtime cannot emulate (apps/namespace-local).
  localNamespace: `preprocess-namespace-${stage}`,
  localScripts: `preprocess-scripts-${stage}`,
  branch: stage,
});

// The app's WorkOS AuthKit secrets, read from the deploy environment and bound
// as secret_text. Required on staging; optional on previews,
// where sign-in stays unavailable until Better Auth replaces WorkOS (step 1).
export const appSecrets = [
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "WORKOS_REDIRECT_URI",
] as const;

// Durable Object classes the API Worker exports.
export const durableObjects = { COUNTER: "Counter" } as const;

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

// The local preprocess_system role (packages/db creates it with this
// local-only password): RLS bypassed, for API key checks and withoutOrg.
export const localSystemDatabaseUrl =
  "postgresql://preprocess_system:preprocess_system@127.0.0.1:5432/preprocess_development";

// Local development's secrets master key. Not a credential: it protects only
// values typed into a local database. Deployed stages bind Secrets Store.
export const localSecretsMasterKey =
  "cHJlcHJvY2Vzcy1sb2NhbC1tYXN0ZXIta2V5LTMyYnk=";
