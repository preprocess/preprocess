// Preprocess's Cloudflare stack. One program deploys every stage in
// src/stages.ts. See README.md for deploys, previews and secrets.
//
// Every stage gets the whole product: the app Worker (uploaded from the build
// its deploy script verified, bound to the API so sign-in and /v1 stay on the
// app's origin), the API Worker with its Durable Objects, R2 buckets, queues
// and consumers, the case runtime that loads agent code as Dynamic Workers,
// the Tail Worker on that code, the GitHub build sandbox (apps/builder, a
// Container), the PDF renderer (apps/pdf-render, a Container), the stub model service (apps/model-stub) unless
// MODEL_SERVICE_URL names a real one, and Postgres behind Hyperdrive.
//
// Stages differ only in their database and what survives a destroy:
// - pr-<number>: its own PlanetScale branch, migrated and seeded, removed with
//   the stage.
// - staging: a long-lived "staging" branch of the same database, migrated,
//   never seeded, protected from deletion.
// - production: the default branch of its own database, migrated, never
//   seeded, protected. Its hostname comes from APP_DOMAIN, so no production
//   configuration lives in this repository.

import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Planetscale from "@alchemy.run/planetscale";
import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Output from "alchemy/Output";
import { Random } from "alchemy/Random";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { regionConfig } from "./src/regions.ts";
import {
  apiCrons,
  apiSecrets,
  githubSecrets,
  githubVars,
  compatibility,
  durableObjects,
  isPreviewStage,
  isStage,
  names,
  runtimeDurableObjects,
  type Stage,
} from "./src/stages.ts";

const root = path.resolve(import.meta.dirname, "..");
const at = (...parts: string[]) => path.join(root, ...parts);

const worker = {
  compatibility: { date: compatibility.date, flags: [...compatibility.flags] },
  observability: { enabled: true },
};

// Deploys upload what the app's build script built and verified (the preview
// sign-in check included), so refuse any other build. Staging and production
// use build:<stage>; previews use build:development.
const builtApp = (stage: Stage) => {
  const dist = at("apps/app/dist");
  let target: unknown;
  try {
    target = (
      JSON.parse(
        readFileSync(path.join(dist, "server/wrangler.json"), "utf8"),
      ) as {
        targetEnvironment?: unknown;
      }
    ).targetEnvironment;
  } catch {
    throw new Error("apps/app/dist is missing. Build the app first.");
  }
  const expected = isPreviewStage(stage) ? undefined : stage;
  if (target !== expected) {
    throw new Error(
      `apps/app/dist is not a build for ${stage}. Run ${expected ? `build:${expected}` : "build:development"} in apps/app.`,
    );
  }
  return dist;
};

// Postgres for the stage, with every migration in packages/db/migrations
// applied before any Worker that uses it is updated. That ordering is why
// migrations must work with the code already running (AGENTS.md). Alchemy
// refuses a directory holding drizzle-kit's meta/ journal, so it reads a copy
// of the .sql files alone, applied in filename order like pnpm db migrate.
const postgres = (stage: Stage) =>
  Effect.gen(function* () {
    const migrations = at("infra/.alchemy/migrations");
    rmSync(migrations, { recursive: true, force: true });
    cpSync(at("packages/db/migrations"), migrations, {
      recursive: true,
      filter: (source) => path.basename(source) !== "meta",
    });
    const name = yield* Config.String("PLANETSCALE_DATABASE");
    if (stage === "production") {
      // The database is created once by hand in the stage's region; the stack
      // adopts it and migrates its default branch. PLANETSCALE_CLUSTER_SIZE
      // must name its current size, or the deploy would resize it.
      const clusterSize = yield* Config.String("PLANETSCALE_CLUSTER_SIZE");
      const database = yield* Planetscale.PostgresDatabase("Database", {
        name,
        clusterSize,
        migrations,
      }).pipe(adopt(), RemovalPolicy.protect());
      return { database, branch: "main" };
    }
    const preview = isPreviewStage(stage);
    const branch = yield* Planetscale.PostgresBranch("Branch", {
      name: names(stage).branch,
      database: name,
      parentBranch: "main",
      migrations,
      ...(preview && { importFiles: [at("packages/db/seed.sql")] }),
    }).pipe(adopt(), RemovalPolicy.protect(!preview));
    return { database: name, branch };
  });

// The key that wraps each organization's data key (design doc 01): 32 random
// bytes, generated once per stage, kept in the account's Secrets Store and
// bound only to the API. Replacing it would make every stored secret
// unreadable, so long-lived stages protect it.
const secretsMasterKey = (stage: Stage) =>
  Effect.gen(function* () {
    const keep = RemovalPolicy.protect(!isPreviewStage(stage));
    const random = yield* Random("SecretsMasterKeyValue", { bytes: 32 }).pipe(
      keep,
    );
    const store = yield* Cloudflare.SecretsStore.Store("SecretsStore");
    return yield* Cloudflare.SecretsStore.Secret("SecretsMasterKey", {
      store,
      name: names(stage).secretsMasterKey,
      value: Output.map(random.text, (hex) =>
        Redacted.make(
          Buffer.from(Redacted.value(hex), "hex").toString("base64"),
        ),
      ),
    }).pipe(keep);
  });

export default Alchemy.Stack(
  "preprocess",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Planetscale.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    if (!isStage(stage)) {
      return yield* Effect.die(
        new Error(
          `Unknown stage "${stage}". This stack deploys staging, production and pr-<number>.`,
        ),
      );
    }
    const preview = isPreviewStage(stage);
    const n = names(stage);
    const dist = builtApp(stage);
    const region = yield* Config.String("PREPROCESS_REGION");
    const { r2LocationHint } = regionConfig(region);
    const keep = RemovalPolicy.protect(!preview);

    // The API, tail, runtime and app bind each other's entrypoints; Alchemy
    // creates each Worker before binding, so the cycle deploys.
    const apiRef = yield* Cloudflare.Worker.ref("Api");

    // Production serves the app on APP_DOMAIN; other stages use workers.dev.
    const appDomain = yield* Config.String("APP_DOMAIN").pipe(
      Config.withDefault(""),
    );
    const app = yield* Cloudflare.Worker("App", {
      ...worker,
      name: n.app,
      main: path.join(dist, "server/index.js"),
      bundle: false,
      rules: [{ globs: ["**/*.js", "**/*.mjs"] }],
      assets: { directory: path.join(dist, "client") },
      workersDev: !appDomain,
      ...(appDomain && { domain: appDomain }),
      env: {
        PREPROCESS_REGION: region,
        API: Cloudflare.WorkerEntrypoint(apiRef),
      },
    });
    const appUrl = appDomain
      ? `https://${appDomain}`
      : Output.map(app.url, (url) => {
          if (!url) throw new Error("The app has no workers.dev URL");
          return url;
        });

    // The docs site documents the API on the app's origin. Production serves
    // it on DOCS_DOMAIN; other stages use workers.dev.
    const docsDomain = yield* Config.String("DOCS_DOMAIN").pipe(
      Config.withDefault(""),
    );
    const docsDist = at("apps/docs/dist");
    if (!existsSync(path.join(docsDist, "server/index.js")))
      throw new Error("apps/docs/dist is missing. Build the docs first.");
    const docs = yield* Cloudflare.Worker("Docs", {
      ...worker,
      name: n.docs,
      main: path.join(docsDist, "server/index.js"),
      bundle: false,
      rules: [{ globs: ["**/*.js", "**/*.mjs"] }],
      assets: { directory: path.join(docsDist, "client") },
      workersDev: !docsDomain,
      ...(docsDomain && { domain: docsDomain }),
      env: {
        API_URL: appDomain
          ? `https://${appDomain}/v1`
          : Output.map(app.url, (url) => `${url}/v1`),
      },
    });
    const docsUrl = docsDomain ? `https://${docsDomain}` : docs.url;

    const { database, branch } = yield* postgres(stage);
    const role = yield* Planetscale.PostgresRole("Role", {
      database,
      branch,
      inheritedRoles: ["postgres"],
    });
    // Auth reads then writes (SCIM, API key revocation, sessions), so query
    // caching stays off on both configs (PLAT-27). DB and DB_SYSTEM should
    // log in as preprocess_app and preprocess_system from bootstrap.sql; until
    // deployed stages run bootstrap, both use the stage's role.
    const db = yield* Cloudflare.Hyperdrive.Connection("Db", {
      origin: role.origin,
      caching: { disabled: true },
    });
    const dbSystem = yield* Cloudflare.Hyperdrive.Connection("DbSystem", {
      origin: role.origin,
      caching: { disabled: true },
    });

    const files = yield* Cloudflare.R2.Bucket("Files", {
      name: n.bucket,
      locationHint: r2LocationHint,
    }).pipe(keep);
    const jobs = yield* Cloudflare.Queues.Queue("Jobs", { name: n.queue });
    const casesQueue = yield* Cloudflare.Queues.Queue("Cases", {
      name: n.casesQueue,
    });
    const webhooksQueue = yield* Cloudflare.Queues.Queue("Webhooks", {
      name: n.webhooksQueue,
    });
    const emailsQueue = yield* Cloudflare.Queues.Queue("Emails", {
      name: n.emailsQueue,
    });
    const emailsSent = yield* Cloudflare.KV.Namespace("EmailsSent", {
      title: n.emailsSent,
    });

    // Run logs (design doc 09). The API's LOGS consumer writes them. With
    // LOG_CATALOG_TOKEN set (R2 Data Catalog, R2 storage and R2 SQL access),
    // they go to a Pipelines stream whose sink writes an Iceberg table the
    // API queries with R2 SQL. Without it the API keeps NDJSON objects in
    // the same bucket, as it does locally.
    const logsQueue = yield* Cloudflare.Queues.Queue("Logs", {
      name: n.logsQueue,
    });
    const logsBucket = yield* Cloudflare.R2.Bucket("LogBucket", {
      name: n.logs,
      locationHint: r2LocationHint,
    });
    const logCatalogToken = yield* Config.Redacted("LOG_CATALOG_TOKEN").pipe(
      Config.withDefault(undefined),
    );
    let logSql = {};
    if (logCatalogToken) {
      const catalog = yield* Cloudflare.Basin.Catalog("LogCatalog", {
        bucket: logsBucket,
        token: logCatalogToken,
      });
      const stream = yield* Cloudflare.Basin.Stream("LogStream", {
        schema: {
          fields: [
            { name: "id", type: "string", required: true },
            { name: "at", type: "string", required: true },
            { name: "organizationId", type: "string", required: true },
            { name: "agentId", type: "string" },
            { name: "deploymentId", type: "string" },
            { name: "caseId", type: "string" },
            { name: "source", type: "string", required: true },
            { name: "level", type: "string", required: true },
            { name: "kind", type: "string", required: true },
            { name: "message", type: "string", required: true },
            { name: "durationMs", type: "float64" },
            { name: "traceId", type: "string" },
            { name: "spanId", type: "string" },
            { name: "error", type: "string" },
            { name: "data", type: "string", required: true },
          ],
        },
      });
      const sink = yield* Cloudflare.Basin.Sink("LogSink", {
        type: "r2_data_catalog",
        catalog,
        table: { namespace: "logs", name: "run_logs" },
        token: logCatalogToken,
        rollingPolicy: { intervalSeconds: 60 },
      });
      yield* Cloudflare.Basin.Pipeline("LogPipeline", {
        sql: Output.interpolate`INSERT INTO ${sink.name} SELECT * FROM ${stream.name}`,
      });
      logSql = {
        LOG_STORE: "sql",
        LOG_STREAM: stream,
        LOG_SQL_BUCKET: n.logs,
        LOG_SQL_TOKEN: logCatalogToken,
      };
    }

    // The daily signed audit manifests (doc 02), locked for a year. Preview
    // stages skip the lock so destroying the stage can empty the bucket.
    const auditBucket = yield* Cloudflare.R2.Bucket("Audit", {
      name: n.auditBucket,
      locationHint: r2LocationHint,
      locks: preview
        ? []
        : [
            {
              id: "audit-one-year",
              enabled: true,
              prefix: "audit/",
              condition: { type: "Age", maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          ],
    }).pipe(keep);

    // Unless MODEL_SERVICE_URL and MODEL_SERVICE_KEY name a real model
    // service, the API and the runtime call the stub (design doc 07) by URL,
    // exactly as they would call a real one. The stub accepts any token.
    const modelServiceUrl = yield* Config.String("MODEL_SERVICE_URL").pipe(
      Config.withDefault(""),
    );
    const modelStub = modelServiceUrl
      ? undefined
      : yield* Cloudflare.Worker("ModelStub", {
          ...worker,
          name: n.modelStub,
          main: at("apps/model-stub/src/index.ts"),
          workersDev: true,
        });
    const modelService = modelStub
      ? {
          MODEL_SERVICE_URL: Output.map(modelStub.url, (url) => {
            if (!url) throw new Error("The model stub has no workers.dev URL");
            return url;
          }),
          MODEL_SERVICE_KEY: "stub",
        }
      : {
          MODEL_SERVICE_URL: modelServiceUrl,
          MODEL_SERVICE_KEY: Config.Redacted("MODEL_SERVICE_KEY"),
        };

    // The GitHub build sandbox: one container per build, started by the
    // BuildSandbox Durable Object from this image (docs/design/08).
    const buildImage = Cloudflare.Container("BuildImage", {
      schedulingPolicy: "durable_object",
      context: root,
      dockerfile: at("apps/builder/Dockerfile"),
    });
    const builder = yield* Cloudflare.Worker("Builder", {
      ...worker,
      name: n.builder,
      main: at("apps/builder/src/index.ts"),
      env: {
        SANDBOX: Cloudflare.DurableObject("BuildSandbox", {
          containers: [buildImage],
        }),
      },
    });

    // PDF pages to PNG images for OCR (design doc 07): one sandbox container
    // per render, started by the Renderer Durable Object from this image.
    const renderImage = Cloudflare.Container("RenderImage", {
      schedulingPolicy: "durable_object",
      context: at("apps/pdf-render"),
      dockerfile: at("apps/pdf-render/Dockerfile"),
    });
    const pdfRender = yield* Cloudflare.Worker("PdfRender", {
      ...worker,
      name: n.pdfRender,
      main: at("apps/pdf-render/src/index.ts"),
      env: {
        RENDERER: Cloudflare.DurableObject("Renderer", {
          containers: [renderImage],
        }),
      },
    });

    // Tail Worker of agent code: console output and exceptions become run
    // logs (design doc 09). The runtime attaches it to each Dynamic Worker.
    const tail = yield* Cloudflare.Worker("Tail", {
      ...worker,
      name: n.tail,
      main: at("apps/tail/src/index.ts"),
      env: { PLATFORM: Cloudflare.WorkerEntrypoint(apiRef, "Platform") },
    });

    // The case runtime (design doc 03): one CaseRuntime Durable Object per
    // case, running each deployment's bundle from BUNDLES as a Dynamic Worker
    // through the Worker Loader.
    const runs = yield* Cloudflare.R2.Bucket("Runs", {
      name: n.runs,
      locationHint: r2LocationHint,
    }).pipe(keep);
    const bundles = yield* Cloudflare.R2.Bucket("Bundles", {
      name: n.bundles,
      locationHint: r2LocationHint,
    }).pipe(keep);
    const runtime = yield* Cloudflare.Worker("Runtime", {
      ...worker,
      name: n.runtime,
      main: at("apps/runtime/src/index.ts"),
      env: {
        STAGE: stage,
        ...modelService,
        CASE_RUNTIME: Cloudflare.DurableObject(
          runtimeDurableObjects.CASE_RUNTIME,
        ),
        RUNS: runs,
        BUNDLES: bundles,
        LOADER: Cloudflare.WorkerLoader("LOADER"),
        TAIL: Cloudflare.WorkerEntrypoint(tail),
        MCP_SERVICE: Cloudflare.WorkerEntrypoint(apiRef, "McpService"),
        PLATFORM: Cloudflare.WorkerEntrypoint(apiRef, "Platform"),
      },
    });

    const api = yield* Cloudflare.Worker("Api", {
      ...worker,
      name: n.api,
      main: at("apps/api/src/index.ts"),
      workersDev: true,
      crons: apiCrons,
      env: {
        STAGE: stage,
        PREPROCESS_REGION: region,
        ...modelService,
        DB: db,
        DB_SYSTEM: dbSystem,
        APP_URL: appUrl,
        EMAIL: Cloudflare.Email.SendEmail("Email"),
        EMAIL_FROM: yield* Config.String("EMAIL_FROM"),
        AUDIT: auditBucket,
        AUDIT_SIGNING_KEY_ID: yield* Config.String("AUDIT_SIGNING_KEY_ID"),
        ...Object.fromEntries(
          apiSecrets.map((name) => [name, Config.Redacted(name)]),
        ),
        SECRETS_MASTER_KEY: yield* secretsMasterKey(stage),
        COUNTER: Cloudflare.DurableObject(durableObjects.COUNTER),
        BUILDS: Cloudflare.DurableObject(durableObjects.BUILDS),
        SCHEDULER: Cloudflare.DurableObject(durableObjects.SCHEDULER),
        RUNTIME: Cloudflare.WorkerEntrypoint(runtime),
        BUILDER: Cloudflare.WorkerEntrypoint(builder, "Builder"),
        PDF_RENDER: Cloudflare.WorkerEntrypoint(pdfRender),
        // The GitHub App, unconfigured (its routes answer 503) until these
        // are set.
        ...Object.fromEntries(
          githubVars.map(
            (name) =>
              [
                name,
                Config.String(name).pipe(Config.withDefault(undefined)),
              ] as const,
          ),
        ),
        ...Object.fromEntries(
          githubSecrets.map(
            (name) =>
              [
                name,
                Config.Redacted(name).pipe(Config.withDefault(undefined)),
              ] as const,
          ),
        ),
        JOBS: jobs,
        CASES: casesQueue,
        WEBHOOKS: webhooksQueue,
        EMAILS: emailsQueue,
        EMAILS_SENT: emailsSent,
        LOGS: logsQueue,
        LOG_BUCKET: logsBucket,
        ...logSql,
        FILES: files,
      },
    });
    yield* Cloudflare.Queues.Consumer("JobsConsumer", {
      queueId: jobs.queueId,
      scriptName: api.workerName,
      settings: { maxWaitTimeMs: 1000 },
    });
    yield* Cloudflare.Queues.Consumer("CasesConsumer", {
      queueId: casesQueue.queueId,
      scriptName: api.workerName,
      settings: { maxWaitTimeMs: 1000 },
    });
    yield* Cloudflare.Queues.Consumer("EmailsConsumer", {
      queueId: emailsQueue.queueId,
      scriptName: api.workerName,
      settings: { maxWaitTimeMs: 1000 },
    });
    yield* Cloudflare.Queues.Consumer("LogsConsumer", {
      queueId: logsQueue.queueId,
      scriptName: api.workerName,
      settings: { maxWaitTimeMs: 5000, batchSize: 100 },
    });
    // The consumer times each retry itself, over 24 hours (doc 06).
    yield* Cloudflare.Queues.Consumer("WebhooksConsumer", {
      queueId: webhooksQueue.queueId,
      scriptName: api.workerName,
      settings: { maxWaitTimeMs: 1000, maxRetries: 20 },
    });

    return {
      app: appUrl,
      docs: docsUrl,
      api: api.url,
      ...(modelStub && { modelStub: modelStub.url }),
      branch: n.branch,
    };
  }),
);
