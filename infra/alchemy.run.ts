// Preprocess's Cloudflare stack. One program deploys every stage in
// src/stages.ts. See README.md for deploys, previews and secrets.
//
// - Every stage gets the app Worker, uploaded from the build its deploy script
//   verified.
// - Preview stages (pr-<number>) also get the backend, isolated per stage: the
//   API Worker with its Durable Object, R2 bucket, queue and consumer, a
//   dispatch namespace with the user Worker, and a PlanetScale branch
//   (migrated and seeded) behind Hyperdrive, and the stub model service
//   (apps/model-stub) the API calls for decide and OCR. Destroying the stage
//   removes all of it.

import { readFileSync } from "node:fs";
import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Planetscale from "@alchemy.run/planetscale";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { regionConfig } from "./src/regions.ts";
import {
  apiCrons,
  apiSecrets,
  appSecrets,
  compatibility,
  isPreviewStage,
  isStage,
  names,
} from "./src/stages.ts";

const root = path.resolve(import.meta.dirname, "..");
const at = (...parts: string[]) => path.join(root, ...parts);

const worker = {
  compatibility: { date: compatibility.date, flags: [...compatibility.flags] },
  observability: { enabled: true },
};

// Deploys upload what the app's build script built and verified (the preview
// sign-in check included), so refuse any other build. Staging uses
// build:staging; previews use build:development.
const builtApp = (stage: string) => {
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

const backend = (
  stage: string,
  region: string,
  appUrl: Output.Output<string | undefined>,
) =>
  Effect.gen(function* () {
    const n = names(stage);

    // The database is long-lived and owned by no preview stage; each stage
    // forks its own branch from main and applies migrations and the seed.
    const database = yield* Config.String("PLANETSCALE_DATABASE");
    const branch = yield* Planetscale.PostgresBranch("Branch", {
      name: n.branch,
      database,
      parentBranch: "main",
      migrations: at("packages/db/migrations"),
      importFiles: [at("packages/db/seed.sql")],
    });
    const role = yield* Planetscale.PostgresRole("Role", {
      database,
      branch,
      inheritedRoles: ["postgres"],
    });
    // Auth reads then writes (SCIM, API key revocation, sessions), so query
    // caching stays off on both configs (PLAT-27). DB and DB_SYSTEM should
    // log in as preprocess_app and preprocess_system from bootstrap.sql; until
    // previews run bootstrap, both use the branch role.
    const db = yield* Cloudflare.Hyperdrive.Connection("Db", {
      origin: role.origin,
      caching: { disabled: true },
    });
    const dbSystem = yield* Cloudflare.Hyperdrive.Connection("DbSystem", {
      origin: role.origin,
      caching: { disabled: true },
    });

    const namespace = yield* Cloudflare.WorkersForPlatforms.DispatchNamespace(
      "Namespace",
      { name: n.namespace },
    );
    yield* Cloudflare.Worker("UserWorker", {
      ...worker,
      name: n.userWorker,
      namespace,
      main: at("apps/user-worker/src/index.ts"),
    });

    const files = yield* Cloudflare.R2.Bucket("Files", {
      name: n.bucket,
      locationHint: regionConfig(region).r2LocationHint,
    });
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

    // The daily signed audit manifests (doc 02), locked for a year. Preview
    // stages skip the lock so destroying the stage can empty the bucket.
    const auditBucket = yield* Cloudflare.R2.Bucket("Audit", {
      name: n.auditBucket,
      locationHint: regionConfig(region).r2LocationHint,
      locks: isPreviewStage(stage)
        ? []
        : [
            {
              id: "audit-one-year",
              enabled: true,
              prefix: "audit/",
              condition: { type: "Age", maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          ],
    });

    // Each preview gets the stub model service (design doc 07). The API calls
    // it by URL, exactly as it would call a real model service; setting
    // MODEL_SERVICE_URL and MODEL_SERVICE_KEY points it at another one.
    const modelStub = yield* Cloudflare.Worker("ModelStub", {
      ...worker,
      name: n.modelStub,
      main: at("apps/model-stub/src/index.ts"),
      workersDev: true,
    });
    const modelServiceUrl = yield* Config.String("MODEL_SERVICE_URL").pipe(
      Config.withDefault(""),
    );
    const api = yield* Cloudflare.Worker("Api", {
      ...worker,
      name: n.api,
      main: at("apps/api/src/index.ts"),
      workersDev: true,
      crons: apiCrons,
      env: {
        STAGE: stage,
        PREPROCESS_REGION: region,
        USER_WORKER: n.userWorker,
        ...(modelServiceUrl
          ? {
              MODEL_SERVICE_URL: modelServiceUrl,
              MODEL_SERVICE_KEY: Config.Redacted("MODEL_SERVICE_KEY"),
            }
          : {
              MODEL_SERVICE_URL: Output.map(modelStub.url, (url) => {
                if (!url)
                  throw new Error("The model stub has no workers.dev URL");
                return url;
              }),
              // The stub accepts any bearer token.
              MODEL_SERVICE_KEY: "stub",
            }),
        DB: db,
        DB_SYSTEM: dbSystem,
        APP_URL: Output.map(appUrl, (url) => {
          if (!url) throw new Error("The app has no workers.dev URL");
          return url;
        }),
        EMAIL: Cloudflare.Email.SendEmail("Email"),
        EMAIL_FROM: yield* Config.String("EMAIL_FROM"),
        AUDIT: auditBucket,
        AUDIT_SIGNING_KEY_ID: yield* Config.String("AUDIT_SIGNING_KEY_ID"),
        ...Object.fromEntries(
          apiSecrets.map((name) => [name, Config.Redacted(name)]),
        ),
        COUNTER: Cloudflare.DurableObject("Counter"),
        JOBS: jobs,
        CASES: casesQueue,
        WEBHOOKS: webhooksQueue,
        EMAILS: emailsQueue,
        EMAILS_SENT: emailsSent,
        FILES: files,
        DISPATCHER: namespace,
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
    // The consumer times each retry itself, over 24 hours (doc 06).
    yield* Cloudflare.Queues.Consumer("WebhooksConsumer", {
      queueId: webhooksQueue.queueId,
      scriptName: api.workerName,
      settings: { maxWaitTimeMs: 1000, maxRetries: 20 },
    });

    return {
      api: api.url,
      modelStub: modelStub.url,
      branch: branch.name,
      namespace: n.namespace,
    };
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
          `Unknown stage "${stage}". This stack deploys staging and pr-<number>.`,
        ),
      );
    }
    const preview = isPreviewStage(stage);
    const dist = builtApp(stage);
    const region = yield* Config.String("PREPROCESS_REGION");
    regionConfig(region);
    const app = yield* Cloudflare.Worker("App", {
      ...worker,
      name: names(stage).app,
      main: path.join(dist, "server/index.js"),
      bundle: false,
      rules: [{ globs: ["**/*.js", "**/*.mjs"] }],
      assets: { directory: path.join(dist, "client") },
      workersDev: true,
      env: {
        PREPROCESS_REGION: region,
        ...Object.fromEntries(
          appSecrets.map((name) => [
            name,
            preview
              ? Config.Redacted(name).pipe(Config.withDefault(undefined))
              : Config.Redacted(name),
          ]),
        ),
      },
    });

    if (!preview) return { app: app.url };
    return { app: app.url, ...(yield* backend(stage, region, app.url)) };
  }),
);
