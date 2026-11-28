// Writes each app's wrangler.jsonc from src/stages.ts. These files only drive
// `vite dev`, `wrangler dev` and the app's build dry runs; deploys go through
// alchemy.run.ts. With --check, fails instead when a committed file differs,
// so `pnpm lint` catches hand edits.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { format, resolveConfig } from "prettier";

import {
  apiCrons,
  compatibility,
  durableObjects,
  LOCAL,
  localAppUrl,
  publicDocsUrl,
  publicStatusUrl,
  localAuditKeyId,
  localEmailFrom,
  localGitHub,
  localModelService,
  localRoleDatabaseUrl,
  localSecretsMasterKey,
  names,
  runtimeDurableObjects,
  sandboxDurableObjects,
} from "../src/stages.ts";

const root = path.resolve(import.meta.dirname, "../..");
const check = process.argv.includes("--check");
const local = names(LOCAL);
const common = {
  compatibility_date: compatibility.date,
  compatibility_flags: compatibility.flags,
  observability: { enabled: true },
};

const configs: Record<string, object> = {
  "apps/app": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.app,
    main: "src/server.ts",
    ...common,
    // The app serves Better Auth (/api/auth/*) and /v1 from the API Worker on
    // its own origin, so session cookies stay first-party.
    services: [{ binding: "API", service: local.api }],
    vars: { DOCS_URL: publicDocsUrl, STATUS_URL: publicStatusUrl },
    // The app builds per stage (CLOUDFLARE_ENV selects the environment).
    env: {
      staging: { name: names("staging").app, workers_dev: true },
      production: { name: names("production").app, workers_dev: false },
    },
  },
  // The docs site documents the API on the app's origin.
  "apps/docs": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.docs,
    main: "src/server.ts",
    ...common,
    vars: { API_URL: `${localAppUrl}/v1`, STATUS_URL: publicStatusUrl },
  },
  "apps/api": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.api,
    main: "src/index.ts",
    ...common,
    vars: {
      STAGE: LOCAL,
      MODEL_SERVICE_URL: localModelService.url,
      MODEL_SERVICE_KEY: localModelService.key,
      SECRETS_MASTER_KEY: localSecretsMasterKey,
      APP_URL: localAppUrl,
      EMAIL_FROM: localEmailFrom,
      AUDIT_SIGNING_KEY_ID: localAuditKeyId,
      GITHUB_APP_ID: localGitHub.appId,
      GITHUB_APP_SLUG: localGitHub.appSlug,
      GITHUB_CLIENT_ID: localGitHub.clientId,
      GITHUB_API_URL: localGitHub.url,
      GITHUB_URL: localGitHub.url,
    },
    hyperdrive: [
      {
        binding: "DB",
        id: "local-app",
        localConnectionString: localRoleDatabaseUrl("preprocess_app"),
      },
      {
        binding: "DB_SYSTEM",
        id: "local-system",
        localConnectionString: localRoleDatabaseUrl("preprocess_system"),
      },
    ],
    triggers: { crons: apiCrons },
    // The local runtime's send_email writes each message to a file and logs
    // its path: the development mail sink.
    send_email: [{ name: "EMAIL" }],
    durable_objects: {
      bindings: Object.entries(durableObjects).map(([name, class_name]) => ({
        name,
        class_name,
      })),
    },
    migrations: [
      { tag: "v1", new_sqlite_classes: Object.values(durableObjects) },
    ],
    queues: {
      producers: [
        { binding: "JOBS", queue: local.queue },
        { binding: "CASES", queue: local.casesQueue },
        { binding: "WEBHOOKS", queue: local.webhooksQueue },
        { binding: "EMAILS", queue: local.emailsQueue },
        { binding: "LOGS", queue: local.logsQueue },
      ],
      consumers: [
        { queue: local.queue, max_batch_timeout: 1 },
        { queue: local.casesQueue, max_batch_timeout: 1 },
        // Retries are timed by the consumer (webhooks.ts) over 24 hours.
        { queue: local.webhooksQueue, max_batch_timeout: 1, max_retries: 20 },
        { queue: local.emailsQueue, max_batch_timeout: 1 },
        { queue: local.logsQueue, max_batch_timeout: 1, max_batch_size: 100 },
      ],
    },
    kv_namespaces: [{ binding: "EMAILS_SENT", id: local.emailsSent }],
    r2_buckets: [
      { binding: "FILES", bucket_name: local.bucket },
      { binding: "AUDIT", bucket_name: local.auditBucket },
      { binding: "LOG_BUCKET", bucket_name: local.logs },
    ],
    services: [
      { binding: "RUNTIME", service: local.runtime },
      { binding: "BUILDER", service: local.builder, entrypoint: "Builder" },
      { binding: "PDF_RENDER", service: local.pdfRender },
    ],
  },
  // Locally the build sandbox runs under Docker (apps/builder/local), because
  // wrangler's container runtime needs a kernel module some hosts lack.
  "apps/builder": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.builder,
    main: "src/index.ts",
    ...common,
    vars: { LOCAL_DOCKER_BUILDER: localGitHub.builder },
  },
  "apps/model-stub": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.modelStub,
    main: "src/index.ts",
    ...common,
  },
  // Its container builds from the Dockerfile; `wrangler dev` runs it in
  // Docker.
  "apps/pdf-render": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.pdfRender,
    main: "src/index.ts",
    ...common,
    containers: [
      { class_name: "Renderer", image: "./Dockerfile", max_instances: 10 },
    ],
    durable_objects: {
      bindings: [{ name: "RENDERER", class_name: "Renderer" }],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["Renderer"] }],
  },
  "apps/runtime": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.runtime,
    main: "src/index.ts",
    ...common,
    vars: {
      STAGE: LOCAL,
      MODEL_SERVICE_URL: localModelService.url,
      MODEL_SERVICE_KEY: localModelService.key,
    },
    // Locally the sandbox classes run without containers, like the build
    // sandbox (wrangler's container runtime needs a kernel module some hosts
    // lack), so their tools answer that sandboxes are unavailable.
    durable_objects: {
      bindings: Object.entries({
        ...runtimeDurableObjects,
        ...sandboxDurableObjects,
      }).map(([name, class_name]) => ({ name, class_name })),
    },
    migrations: [
      { tag: "v1", new_sqlite_classes: Object.values(runtimeDurableObjects) },
      { tag: "v2", new_sqlite_classes: Object.values(sandboxDurableObjects) },
    ],
    r2_buckets: [
      { binding: "RUNS", bucket_name: local.runs },
      { binding: "BUNDLES", bucket_name: local.bundles },
    ],
    worker_loaders: [{ binding: "LOADER" }],
    services: [
      { binding: "TAIL", service: local.tail },
      { binding: "MCP_SERVICE", service: local.api, entrypoint: "McpService" },
      { binding: "PLATFORM", service: local.api, entrypoint: "Platform" },
    ],
  },
  "apps/tail": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.tail,
    main: "src/index.ts",
    ...common,
    services: [
      { binding: "PLATFORM", service: local.api, entrypoint: "Platform" },
    ],
  },
};

const header = `// Generated by infra/scripts/wrangler-config.ts from infra/src/stages.ts.
// Do not edit: change infra/src/stages.ts and run
// \`pnpm --filter @preprocess/infra wrangler:generate\`. Deploys use the Alchemy
// stack in infra/, not this file.
`;

const stale: string[] = [];
for (const [dir, config] of Object.entries(configs)) {
  const file = path.join(root, dir, "wrangler.jsonc");
  const expected = await format(header + JSON.stringify(config), {
    ...(await resolveConfig(file)),
    filepath: file,
  });
  const current = await readFile(file, "utf8").catch(() => "");
  if (current === expected) continue;
  if (check) stale.push(path.relative(root, file));
  else {
    await writeFile(file, expected);
    console.log(`Wrote ${path.relative(root, file)}`);
  }
}

if (stale.length > 0) {
  console.error(
    `${stale.join(", ")} differ from infra/src/stages.ts. Run \`pnpm --filter @preprocess/infra wrangler:generate\`.`,
  );
  process.exit(1);
}
