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
// Stages differ only in their database, run mode and what survives a destroy:
// - pr-<number>: its own PlanetScale branch, migrated and seeded, removed with
//   the stage.
// - staging: a long-lived "staging" branch of the same database, migrated,
//   never seeded, protected from deletion.
// - production: the default branch of its own database, migrated, never
//   seeded, protected. Its hostname comes from APP_DOMAIN, so no production
//   configuration lives in this repository.
// - selfhost[-<name>]: a customer's install in their own account (spec 16).
//   Their own Postgres from DATABASE_URL, bootstrapped and migrated, never
//   seeded, never dropped. No PREPROCESS_REGION is bound, so it runs in
//   self-hosted mode; R2_LOCATION_HINT places its buckets. The API's signing
//   and auth secrets are generated once into the stack's state. Its models
//   come from its own provider keys, MODEL_ENDPOINTS or MODEL_SERVICE_URL,
//   and Qwen from Workers AI in its own account; MODEL_SERVICE_URL=stub
//   deploys the stub for trying it.

import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Planetscale from "@alchemy.run/planetscale";
import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import { KeyPair } from "alchemy/KeyPair";
import * as Output from "alchemy/Output";
import { Random } from "alchemy/Random";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { GrantAppRole } from "./src/app-role.ts";
import { originConnectionLimits } from "./src/connections.ts";
import {
  roleOrigin,
  schemaDigest,
  SelfHostDatabase,
  SelfHostDatabaseProvider,
} from "./src/database.ts";
import { regionConfig } from "./src/regions.ts";
import {
  analyticsVars,
  apiCrons,
  apiModelSecrets,
  apiSecrets,
  billingSecrets,
  billingOrgs,
  billingVars,
  githubSecrets,
  githubVars,
  googleSecrets,
  googleVars,
  imageRepositories,
  licenseSecrets,
  compatibility,
  deadLetterQueues,
  durableObjects,
  isPreviewStage,
  isSelfHostStage,
  isStage,
  callsRealModels,
  names,
  runtimeDurableObjects,
  sandboxDurableObjects,
  sandboxImages,
  runtimeModelSecrets,
  statusHeartbeatSecrets,
  statusHeartbeatVars,
  trainingVars,
  turnstileSecrets,
  turnstileTestKeys,
  turnstileVars,
  type SelfHostStage,
  type Stage,
  publicDocsUrl,
  publicStatusUrl,
  refuseIcebergLogs,
  posthogProject,
  posthogVars,
} from "./src/stages.ts";

const root = path.resolve(import.meta.dirname, "..");
const at = (...parts: string[]) => path.join(root, ...parts);

const worker = {
  compatibility: { date: compatibility.date, flags: [...compatibility.flags] },
  observability: { enabled: true },
};

// Deploys upload what the app's build script built and verified (the preview
// sign-in check included), so refuse any other build. Staging and production
// use build:<stage>, self-hosted installs build:production, and previews
// build:development.
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
  // A self-hosted install runs the production build: no preview sign-in.
  const expected = isPreviewStage(stage)
    ? undefined
    : isSelfHostStage(stage)
      ? "production"
      : stage;
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
const planetscale = (stage: Exclude<Stage, SelfHostStage>) =>
  Effect.gen(function* () {
    const migrations = at("infra/.alchemy/migrations");
    rmSync(migrations, { recursive: true, force: true });
    cpSync(at("packages/db/migrations"), migrations, {
      recursive: true,
      filter: (source) => path.basename(source) !== "meta",
    });
    const name = yield* Config.String("PLANETSCALE_DATABASE");
    if (stage === "production") {
      // The database is created once by hand in the stage's region, and its
      // size and settings stay out of the stack: adopting a PostgresDatabase
      // always rewrites its settings, which the production token may not do.
      // The stack adopts only the default branch and migrates it.
      const branch = yield* Planetscale.PostgresBranch("Branch", {
        name: "main",
        database: name,
        migrations,
      }).pipe(adopt(), RemovalPolicy.protect());
      return { database: name, branch };
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
// A self-hosted install's Postgres: the customer's server from DATABASE_URL,
// with bootstrap.sql's roles under generated passwords, and Hyperdrive logging
// in as preprocess_app and preprocess_system once the migrations have run.
const selfHostPostgres = Effect.gen(function* () {
  const url = yield* Config.Redacted("DATABASE_URL");
  const keep = RemovalPolicy.protect();
  const password = (id: string) =>
    Random(id, { bytes: 24 }).pipe(
      keep,
      Effect.map((random) => random.text),
    );
  const passwords = {
    migrator_password: yield* password("MigratorPassword"),
    app_password: yield* password("AppPassword"),
    system_password: yield* password("SystemPassword"),
    purge_password: yield* password("AuditPurgePassword"),
  };
  const database = yield* SelfHostDatabase("Database", {
    url,
    passwords,
    digest: schemaDigest(at("packages/db")),
  });
  const origin = (user: string, secret: (typeof passwords)["app_password"]) =>
    Output.map(Output.all(database.digest, secret), ([, value]) =>
      roleOrigin(Redacted.value(url), user, value),
    );
  return {
    app: origin("preprocess_app", passwords.app_password),
    system: origin("preprocess_system", passwords.system_password),
  };
});

// The API's own secrets. Our stages take them from the deploy environment; a
// self-hosted install generates them once and keeps them in its state:
// BETTER_AUTH_SECRET as 32 random bytes and AUDIT_SIGNING_KEY as an Ed25519
// key in PKCS #8 DER, both base64, with a key id derived from the public key.
const apiSecretBindings = (stage: Stage) =>
  Effect.gen(function* () {
    if (!isSelfHostStage(stage))
      return {
        AUDIT_SIGNING_KEY_ID: yield* Config.String("AUDIT_SIGNING_KEY_ID"),
        ...Object.fromEntries(
          apiSecrets.map((name) => [name, Config.Redacted(name)]),
        ),
      };
    const keep = RemovalPolicy.protect();
    const authSecret = yield* Random("BetterAuthSecret", { bytes: 32 }).pipe(
      keep,
    );
    const auditKey = yield* KeyPair("AuditSigningKey").pipe(keep);
    const pemBody = (pem: string) =>
      pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
    return {
      BETTER_AUTH_SECRET: Output.map(authSecret.text, (hex) =>
        Redacted.make(
          Buffer.from(Redacted.value(hex), "hex").toString("base64"),
        ),
      ),
      AUDIT_SIGNING_KEY: Output.map(auditKey.privateKey, (pem) =>
        Redacted.make(pemBody(Redacted.value(pem))),
      ),
      AUDIT_SIGNING_KEY_ID: Output.map(
        auditKey.publicKey,
        (pem) =>
          `audit-ed25519-${createHash("sha256").update(pemBody(pem)).digest("hex").slice(0, 16)}`,
      ),
    };
  });

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
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      Planetscale.providers(),
      SelfHostDatabaseProvider(),
    ),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    if (!isStage(stage)) {
      return yield* Effect.die(
        new Error(
          `Unknown stage "${stage}". This stack deploys staging, production, pr-<number> and selfhost[-<name>].`,
        ),
      );
    }
    const preview = isPreviewStage(stage);
    const selfHost = isSelfHostStage(stage);
    const n = names(stage);
    const dist = builtApp(stage);
    // Run mode (spec 16): our stages bind PREPROCESS_REGION, which places
    // their resources and marks them as our cloud. A self-hosted install
    // binds nothing, and takes R2 placement from its own optional input.
    const region = yield* Config.String("PREPROCESS_REGION").pipe(
      Config.withDefault(""),
    );
    if (selfHost && region)
      return yield* Effect.die(
        new Error(
          "PREPROCESS_REGION marks a deploy as our cloud (spec 16). Unset it for a self-hosted install; R2_LOCATION_HINT places its buckets.",
        ),
      );
    if (!selfHost && !region)
      return yield* Effect.die(
        new Error(`PREPROCESS_REGION is required for ${stage}.`),
      );
    const r2LocationHint = region
      ? regionConfig(region).r2LocationHint
      : ((yield* Config.String("R2_LOCATION_HINT").pipe(
          Config.withDefault(undefined),
        )) as Cloudflare.R2.Bucket.Location | undefined);
    const placement = r2LocationHint ? { locationHint: r2LocationHint } : {};
    const apiPlacement = region
      ? { placement: { region: regionConfig(region).databaseRegion } }
      : {};
    const runMode = region ? { PREPROCESS_REGION: region } : {};
    const keep = RemovalPolicy.protect(!preview);
    // PostHog for the app, docs, API and runtime: our production's project
    // from stages.ts, a self-hosted install's own when its deploy sets
    // POSTHOG_KEY, and nothing on staging or previews.
    const posthog = selfHost
      ? Object.fromEntries(
          posthogVars.map(
            (name) =>
              [
                name,
                Config.String(name).pipe(Config.withDefault(undefined)),
              ] as const,
          ),
        )
      : (posthogProject[stage] ?? {});

    // The API, tail, runtime and app bind each other's entrypoints; Alchemy
    // creates each Worker before binding, so the cycle deploys.
    const apiRef = yield* Cloudflare.Worker.ref("Api");

    // Production serves the app on APP_DOMAIN; other stages use workers.dev.
    const appDomain = yield* Config.String("APP_DOMAIN").pipe(
      Config.withDefault(""),
    );
    const docsDomain = yield* Config.String("DOCS_DOMAIN").pipe(
      Config.withDefault(""),
    );
    // The Turnstile widget for sign-in and sign-up (PRE-165), managed mode on
    // production's app domain; its sitekey goes to the app and its secret to
    // the API, which checks each sign-in link's token (stages.ts).
    const turnstile =
      stage === "production" && appDomain
        ? yield* Cloudflare.Turnstile.Widget("SignInWidget", {
            domains: [appDomain],
            mode: "managed",
          }).pipe(keep)
        : undefined;
    const turnstileKeys = turnstile
      ? { sitekey: turnstile.sitekey, secret: turnstile.secret }
      : selfHost
        ? {
            sitekey: yield* Config.String(turnstileVars[0]).pipe(
              Config.withDefault(undefined),
            ),
            secret: yield* Config.Redacted(turnstileSecrets[0]).pipe(
              Config.withDefault(undefined),
            ),
          }
        : stage === "production"
          ? {}
          : turnstileTestKeys;
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
        ...runMode,
        ...posthog,
        STAGE: stage,
        API: Cloudflare.WorkerEntrypoint(apiRef),
        ...(turnstileKeys.sitekey &&
          turnstileKeys.secret && {
            [turnstileVars[0]]: turnstileKeys.sitekey,
          }),
        // Where the app links to docs: the stage's own docs domain, else the
        // public docs, so the app never waits on the docs Worker's URL.
        DOCS_URL: docsDomain ? `https://${docsDomain}` : publicDocsUrl,
        // Our status page; a self-hosted install links none (spec 16).
        ...(!selfHost && { STATUS_URL: publicStatusUrl }),
        // Shows the Google button; the API holds the secret.
        ...Object.fromEntries(
          googleVars.map(
            (name) =>
              [
                name,
                Config.String(name).pipe(Config.withDefault(undefined)),
              ] as const,
          ),
        ),
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
        ...posthog,
        STAGE: stage,
        API_URL: appDomain
          ? `https://${appDomain}/v1`
          : Output.map(app.url, (url) => `${url}/v1`),
        ...(!selfHost && { STATUS_URL: publicStatusUrl }),
      },
    });
    const docsUrl = docsDomain ? `https://${docsDomain}` : docs.url;

    const roles = selfHost
      ? yield* selfHostPostgres
      : yield* Effect.gen(function* () {
          const { database, branch } = yield* planetscale(stage);
          const role = yield* Planetscale.PostgresRole("Role", {
            database,
            branch,
            inheritedRoles: ["postgres"],
          });
          const appRole = yield* Planetscale.PostgresRole("AppRole", {
            database,
            branch,
            inheritedRoles: [],
          });
          const granted = yield* GrantAppRole("GrantAppRole", {
            admin: role.origin,
            app: appRole.origin,
            connectionLimits: originConnectionLimits,
            output: 2,
          });
          return {
            app: Output.map(granted, ({ app }) => app),
            system: Output.map(granted, ({ system }) => system),
          };
        });
    // On our stages DB logs in as its own PlanetScale role, made a member of
    // preprocess_app (migration 0001) without BYPASSRLS by GrantAppRole, and
    // withOrg switches each transaction to preprocess_app. DB_SYSTEM logs in
    // as the stage's role, the only bypass path. A self-hosted install logs in
    // as preprocess_app and preprocess_system directly. Auth reads then writes (SCIM, API key revocation, sessions),
    // so query caching stays off on both configs (PLAT-27).
    const db = yield* Cloudflare.Hyperdrive.Connection("Db", {
      origin: roles.app,
      caching: { disabled: true },
      originConnectionLimit: originConnectionLimits.app,
    });
    const dbSystem = yield* Cloudflare.Hyperdrive.Connection("DbSystem", {
      origin: roles.system,
      caching: { disabled: true },
      originConnectionLimit: originConnectionLimits.system,
    });

    const files = yield* Cloudflare.R2.Bucket("Files", {
      name: n.bucket,
      ...placement,
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
    // Dead letters (stages.ts deadLetters), one queue per consumer, kept as
    // long as Queues allows so a failure can be read and replayed.
    const deadLetters = Object.fromEntries(
      yield* Effect.all(
        deadLetterQueues.map((queue) =>
          Cloudflare.Queues.Queue(`DeadLetters-${queue}`, {
            name: n.deadLetters(queue),
            messageRetentionPeriod: 14 * 24 * 60 * 60,
          }).pipe(Effect.map((dlq) => [queue, dlq] as const)),
        ),
      ),
    ) as Record<(typeof deadLetterQueues)[number], Cloudflare.Queues.Queue>;
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
      ...placement,
    });
    const logCatalogToken = yield* Config.Redacted("LOG_CATALOG_TOKEN").pipe(
      Config.withDefault(undefined),
    );
    const icebergRefusal = refuseIcebergLogs(logCatalogToken !== undefined);
    if (icebergRefusal) return yield* Effect.die(new Error(icebergRefusal));
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
        CLOUDFLARE_ACCOUNT_ID: (yield* yield* Cloudflare.CloudflareEnvironment)
          .accountId,
      };
    }

    // The daily signed audit manifests (doc 02), locked for a year. Preview
    // stages skip the lock so destroying the stage can empty the bucket.
    const auditBucket = yield* Cloudflare.R2.Bucket("Audit", {
      name: n.auditBucket,
      ...placement,
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

    // Each model is served by its provider when the provider's key is set
    // (packages/models endpoints), and Qwen by the runtime's Workers AI
    // binding. Every other model goes to MODEL_SERVICE_URL: on our stages
    // other than production that is the stub (design doc 07) unless it names
    // a real service, and a self-hosted install gets the stub only with
    // MODEL_SERVICE_URL=stub. The stub accepts any token. A stage that calls
    // no real models (previews, and staging unless REAL_MODELS=true) binds no
    // provider key and no Workers AI, so the stub serves every call.
    const realModels = callsRealModels(
      stage,
      yield* Config.Boolean("REAL_MODELS").pipe(Config.withDefault(false)),
    );
    const modelServiceUrl = yield* Config.String("MODEL_SERVICE_URL").pipe(
      Config.withDefault(""),
    );
    const modelStub =
      !realModels ||
      modelServiceUrl === "stub" ||
      (!modelServiceUrl && !selfHost && stage !== "production")
        ? yield* Cloudflare.Worker("ModelStub", {
            ...worker,
            name: n.modelStub,
            main: at("apps/model-stub/src/index.ts"),
            workersDev: true,
          })
        : undefined;
    const modelService = modelStub
      ? {
          MODEL_SERVICE_URL: Output.map(modelStub.url, (url) => {
            if (!url) throw new Error("The model stub has no workers.dev URL");
            return url;
          }),
          MODEL_SERVICE_KEY: "stub",
        }
      : modelServiceUrl
        ? {
            MODEL_SERVICE_URL: modelServiceUrl,
            MODEL_SERVICE_KEY: Config.Redacted("MODEL_SERVICE_KEY"),
          }
        : {};
    const optionalSecrets = (secrets: readonly string[]) =>
      Object.fromEntries(
        secrets.map(
          (name) =>
            [
              name,
              Config.Redacted(name).pipe(Config.withDefault(undefined)),
            ] as const,
        ),
      );

    // The GitHub build sandbox: one container per build, started by the
    // BuildSandbox Durable Object from this image (docs/design/08).
    const buildImage = Cloudflare.Container("BuildImage", {
      schedulingPolicy: "durable_object",
      context: root,
      dockerfile: at("apps/builder/Dockerfile"),
      publish: { repository: imageRepositories.build },
    });
    const builder = yield* Cloudflare.Worker("Builder", {
      ...worker,
      name: n.builder,
      main: at("apps/builder/src/index.ts"),
      env: {
        SANDBOX: Cloudflare.DurableObject("BuildSandbox", {
          containers: [buildImage],
        }),
        // Times each build's container for metering (spec 16a).
        PLATFORM: Cloudflare.WorkerEntrypoint(apiRef, "Platform"),
      },
    });

    // PDF pages to PNG images for OCR (design doc 07): one sandbox container
    // per render, started by the Renderer Durable Object from this image.
    const renderImage = Cloudflare.Container("RenderImage", {
      schedulingPolicy: "durable_object",
      context: at("apps/pdf-render"),
      dockerfile: at("apps/pdf-render/Dockerfile"),
      publish: { repository: imageRepositories.render },
    });
    const pdfRender = yield* Cloudflare.Worker("PdfRender", {
      ...worker,
      name: n.pdfRender,
      main: at("apps/pdf-render/src/index.ts"),
      env: {
        RENDERER: Cloudflare.DurableObject("Renderer", {
          containers: [renderImage],
        }),
        // Times each render's container for metering (spec 16a).
        PLATFORM: Cloudflare.WorkerEntrypoint(apiRef, "Platform"),
      },
    });

    // Case sandboxes (spec 3): the platform's preset images, which the
    // sandbox classes start by name. Never a customer's image.
    const sandboxContainers = Object.entries(sandboxImages).map(
      ([id, preset]) =>
        Cloudflare.Container(id, {
          schedulingPolicy: "durable_object",
          context: at("apps/runtime/sandbox"),
          dockerfile: at("apps/runtime/sandbox/Dockerfile"),
          build: { args: { PRESET: preset } },
          publish: { repository: imageRepositories[`sandbox-${preset}`] },
        }),
    );
    const sandboxes = Object.fromEntries(
      Object.entries(sandboxDurableObjects).map(([binding, className]) => [
        binding,
        Cloudflare.DurableObject(className, {
          containers: sandboxContainers,
        }),
      ]),
    );

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
      ...placement,
    }).pipe(keep);
    const bundles = yield* Cloudflare.R2.Bucket("Bundles", {
      name: n.bundles,
      ...placement,
    }).pipe(keep);
    const runtime = yield* Cloudflare.Worker("Runtime", {
      ...worker,
      name: n.runtime,
      main: at("apps/runtime/src/index.ts"),
      env: {
        STAGE: stage,
        ...runMode,
        ...posthog,
        ...modelService,
        ...(realModels && {
          ...optionalSecrets(runtimeModelSecrets),
          AI: Cloudflare.Workers.AI(),
        }),
        CASE_RUNTIME: Cloudflare.DurableObject(
          runtimeDurableObjects.CASE_RUNTIME,
        ),
        ...sandboxes,
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
      ...apiPlacement,
      workersDev: true,
      crons: apiCrons,
      env: {
        STAGE: stage,
        ...runMode,
        ...posthog,
        ...modelService,
        ...(realModels && optionalSecrets(apiModelSecrets)),
        DB: db,
        DB_SYSTEM: dbSystem,
        ...(turnstileKeys.sitekey &&
          turnstileKeys.secret && {
            [turnstileSecrets[0]]: turnstileKeys.secret,
          }),
        APP_URL: appUrl,
        EMAIL: Cloudflare.Email.SendEmail("Email"),
        EMAIL_FROM: yield* Config.String("EMAIL_FROM"),
        AUDIT: auditBucket,
        ...(yield* apiSecretBindings(stage)),
        SECRETS_MASTER_KEY: yield* secretsMasterKey(stage),
        COUNTER: Cloudflare.DurableObject(durableObjects.COUNTER),
        BUILDS: Cloudflare.DurableObject(durableObjects.BUILDS),
        SCHEDULER: Cloudflare.DurableObject(durableObjects.SCHEDULER),
        RATE_LIMITER: Cloudflare.DurableObject(durableObjects.RATE_LIMITER),
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
          googleVars.map(
            (name) =>
              [
                name,
                Config.String(name).pipe(Config.withDefault(undefined)),
              ] as const,
          ),
        ),
        ...Object.fromEntries(
          googleSecrets.map(
            (name) =>
              [
                name,
                Config.Redacted(name).pipe(Config.withDefault(undefined)),
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
        ...(region &&
          Object.fromEntries(
            billingSecrets.map(
              (name) =>
                [
                  name,
                  Config.Redacted(name).pipe(Config.withDefault(undefined)),
                ] as const,
            ),
          )),
        ...(region &&
          Object.fromEntries(
            billingVars.map(
              (name) =>
                [
                  name,
                  Config.String(name).pipe(Config.withDefault(undefined)),
                ] as const,
            ),
          )),
        ...(region &&
          Object.fromEntries(
            statusHeartbeatVars.map(
              (name) =>
                [
                  name,
                  Config.String(name).pipe(Config.withDefault(undefined)),
                ] as const,
            ),
          )),
        ...(region && optionalSecrets(statusHeartbeatSecrets)),
        ...(region &&
          billingOrgs[stage] && {
            BILLING_INTERNAL_ORGS: billingOrgs[stage].internal.join(","),
            BILLING_ENFORCED_ORGS: billingOrgs[stage].enforced.join(","),
          }),
        ...(region &&
          Object.fromEntries(
            analyticsVars.map(
              (name) =>
                [
                  name,
                  Config.String(name).pipe(Config.withDefault(undefined)),
                ] as const,
            ),
          )),
        ...Object.fromEntries(
          (selfHost ? licenseSecrets : []).map(
            (name) =>
              [
                name,
                Config.Redacted(name).pipe(Config.withDefault(undefined)),
              ] as const,
          ),
        ),
        ...Object.fromEntries(
          (selfHost ? trainingVars : []).map(
            (name) =>
              [
                name,
                Config.String(name).pipe(Config.withDefault(undefined)),
              ] as const,
          ),
        ),
        JOBS: jobs,
        CASES: casesQueue,
        WEBHOOKS: webhooksQueue,
        EMAILS: emailsQueue,
        EMAILS_SENT: emailsSent,
        LOGS: logsQueue,
        ...Object.fromEntries(
          deadLetterQueues.map((queue) => [
            `${queue.toUpperCase()}_DLQ`,
            deadLetters[queue],
          ]),
        ),
        LOG_BUCKET: logsBucket,
        ...logSql,
        FILES: files,
      },
    });
    yield* Cloudflare.Queues.Consumer("JobsConsumer", {
      queueId: jobs.queueId,
      scriptName: api.workerName,
      deadLetterQueue: deadLetters.jobs.queueName,
      settings: { maxWaitTimeMs: 1000 },
    });
    yield* Cloudflare.Queues.Consumer("CasesConsumer", {
      queueId: casesQueue.queueId,
      scriptName: api.workerName,
      deadLetterQueue: deadLetters.cases.queueName,
      settings: { maxWaitTimeMs: 1000 },
    });
    yield* Cloudflare.Queues.Consumer("EmailsConsumer", {
      queueId: emailsQueue.queueId,
      scriptName: api.workerName,
      deadLetterQueue: deadLetters.emails.queueName,
      settings: { maxWaitTimeMs: 1000 },
    });
    yield* Cloudflare.Queues.Consumer("LogsConsumer", {
      queueId: logsQueue.queueId,
      scriptName: api.workerName,
      deadLetterQueue: deadLetters.logs.queueName,
      settings: { maxWaitTimeMs: 5000, batchSize: 100 },
    });
    // The consumer times each retry itself, over 24 hours (doc 06).
    yield* Cloudflare.Queues.Consumer("WebhooksConsumer", {
      queueId: webhooksQueue.queueId,
      scriptName: api.workerName,
      deadLetterQueue: deadLetters.webhooks.queueName,
      settings: { maxWaitTimeMs: 1000, maxRetries: 20 },
    });

    return {
      app: appUrl,
      docs: docsUrl,
      api: api.url,
      ...(modelStub && { modelStub: modelStub.url }),
      ...(turnstile && { turnstileSitekey: turnstile.sitekey }),
      branch: n.branch,
    };
  }),
);
