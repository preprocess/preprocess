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
  localAuditKeyId,
  localEmailFrom,
  localModelService,
  localRoleDatabaseUrl,
  localSecretsMasterKey,
  names,
  runtimeDurableObjects,
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
    main: "@tanstack/react-start/server-entry",
    ...common,
    // The app builds per stage (CLOUDFLARE_ENV selects the environment).
    env: { staging: { name: names("staging").app, workers_dev: true } },
  },
  "apps/api": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.api,
    main: "src/index.ts",
    ...common,
    vars: {
      STAGE: LOCAL,
      USER_WORKER: local.userWorker,
      MODEL_SERVICE_URL: localModelService.url,
      MODEL_SERVICE_KEY: localModelService.key,
      SECRETS_MASTER_KEY: localSecretsMasterKey,
      APP_URL: localAppUrl,
      EMAIL_FROM: localEmailFrom,
      AUDIT_SIGNING_KEY_ID: localAuditKeyId,
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
        { binding: "SECRET_SYNC", queue: local.secretSync },
      ],
      consumers: [
        { queue: local.queue, max_batch_timeout: 1 },
        { queue: local.secretSync, max_batch_timeout: 1 },
      ],
    },
    r2_buckets: [
      { binding: "FILES", bucket_name: local.bucket },
      { binding: "AUDIT", bucket_name: local.auditBucket },
    ],
    // Wrangler supports dispatch namespaces only as remote bindings, so the
    // local API reaches the user Worker through a service binding, and
    // uploads agent scripts to apps/namespace-local.
    services: [
      { binding: "LOCAL_USER_WORKER", service: local.userWorker },
      { binding: "RUNTIME", service: local.runtime },
      {
        binding: "LOCAL_NAMESPACE",
        service: local.localNamespace,
        entrypoint: "Namespace",
      },
    ],
  },
  "apps/model-stub": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.modelStub,
    main: "src/index.ts",
    ...common,
  },
  "apps/user-worker": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.userWorker,
    main: "src/index.ts",
    ...common,
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
    durable_objects: {
      bindings: Object.entries(runtimeDurableObjects).map(
        ([name, class_name]) => ({ name, class_name }),
      ),
    },
    migrations: [
      { tag: "v1", new_sqlite_classes: Object.values(runtimeDurableObjects) },
    ],
    r2_buckets: [{ binding: "RUNS", bucket_name: local.runs }],
    services: [
      { binding: "LOCAL_NAMESPACE", service: local.localNamespace },
      { binding: "MCP_SERVICE", service: local.api, entrypoint: "McpService" },
    ],
  },
  "apps/outbound": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.outbound,
    main: "src/index.ts",
    ...common,
  },
  "apps/namespace-local": {
    $schema: "node_modules/wrangler/config-schema.json",
    name: local.localNamespace,
    main: "src/index.ts",
    ...common,
    worker_loaders: [{ binding: "LOADER" }],
    r2_buckets: [{ binding: "SCRIPTS", bucket_name: local.localScripts }],
    services: [
      { binding: "OUTBOUND", service: local.outbound, entrypoint: "Egress" },
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
