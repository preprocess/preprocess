# Infrastructure

The Alchemy stack that deploys Preprocess to Cloudflare. Alchemy is pinned to
`2.0.0-beta.87` (Alchemy 2, Effect-based, still in beta); upgrade it
deliberately and read its changelog first.

- `src/stages.ts` holds every stage, name, binding and secret.
- `src/regions.ts` maps each region to the provider locations it uses. Every
  deploy names its region with `PREPROCESS_REGION`; nothing hard-codes one.
- `alchemy.run.ts` is the stack. State lives in Alchemy's built-in Cloudflare
  store, `Cloudflare.state()`.
- `scripts/wrangler-config.ts` writes `apps/*/wrangler.jsonc` from
  `src/stages.ts`. Those files drive local development and the app's build dry
  runs only; `pnpm lint` fails if they drift.
- `scripts/preview.ts` deploys or destroys one `pr-<number>` stage and prints
  its outputs.

## Stages

| Stage         | Database                                                      | On destroy         |
| ------------- | ------------------------------------------------------------- | ------------------ |
| `pr-<number>` | Its own branch of `main`, migrated and seeded                 | Everything removed |
| `staging`     | Long-lived `staging` branch of `main`, migrated, never seeded | Data is protected  |
| `production`  | Default branch of its own database, migrated, never seeded    | Data is protected  |
| `development` | Never deployed; the names `pnpm dev` uses locally             |                    |

Every stage deploys the whole product, the same way:

- the app Worker, bound to the API, so Better Auth (`/api/auth/*`) and `/v1` are
  served on the app's own origin, as under `pnpm dev`;
- the API Worker with its Durable Objects (`Counter`, `BuildQueue`,
  `Scheduler`), crons, queues and consumers, R2 buckets (files, logs, audit),
  the email binding, and `SECRETS_MASTER_KEY`, which the stack generates once
  per stage into the account's Secrets Store;
- the case runtime (`apps/runtime`): the `CaseRuntime` Durable Object, its runs
  and bundles buckets, and the Worker Loader that runs each deployment's bundle
  as a Dynamic Worker;
- the Tail Worker on agent code, the GitHub build sandbox (`apps/builder`, a
  Container), and the stub model service (`apps/model-stub`) unless
  `MODEL_SERVICE_URL` and `MODEL_SERVICE_KEY` name a real one;
- Postgres through two Hyperdrive configs (caching off), with every file in
  `packages/db/migrations` applied before any Worker is updated.

Stages differ only in their database (above) and hostname. Previews and staging
are served on workers.dev and need no DNS. Production serves the app on
`APP_DOMAIN` and the docs site (`apps/docs`) on `DOCS_DOMAIN` when they are set;
the docs' API reference points at the app's origin. Its values (hostname,
database, credentials) come from the deploy environment, so our cloud's
production configuration stays private; a self-hosted install sets its own. On
staging and production the database, the file, audit, runs and bundles buckets
and the secrets master key are protected: a plan that would delete or replace
them fails.

Because migrations run while the previous Workers still serve, every migration
must work with both the old and the new code (expand, then contract; see
`AGENTS.md`).

## Regions

Region is configuration (spec 16d). Each deploy sets `PREPROCESS_REGION` to a
key of `src/regions.ts`; the stack places the R2 bucket by that entry and binds
`PREPROCESS_REGION` on the Workers, which read it through `@preprocess/runmode`.
The PlanetScale database (`PLANETSCALE_DATABASE`) must be created in the same
region, because branches live where their database does. We launch in `us` only;
adding a region adds an entry and a database.

## Deploy staging and production

Once per account, bootstrap the state store from a laptop:
`pnpm --filter @preprocess/infra exec alchemy state bootstrap`. CI refuses to
create it.

```sh
cp infra/.env.example infra/.env.staging   # fill it in; ignored by Git
pnpm --filter @preprocess/infra plan:staging -- --env-file .env.staging
pnpm --filter @preprocess/infra deploy:staging -- --env-file .env.staging
```

`plan:production` and `deploy:production` work the same way. Production also
needs `PLANETSCALE_CLUSTER_SIZE`, the current size of its database, which the
stack adopts on first deploy and must never resize, and usually `APP_DOMAIN` and
`DOCS_DOMAIN`.

Always read the plan first. Secrets come only from the deploy environment and
are bound as `secret_text`; Alchemy keeps the deployed values in its state,
encrypted with a key held in the account's Secrets Store, so treat the deploy
token like a production secret.

## Pull request previews

`.github/workflows/preview.yml` runs on every same-repository pull request: it
deploys `pr-<number>`, runs `scripts/smoke.ts` against it, and posts one comment
with the URLs, updated on each push. When the pull request closes it destroys
the stage and updates the comment. Pull requests from forks get no secrets and
no preview.

Previews are off until the repository variable `PREPROCESS_REGION` is set:
without it the job reports skipped. Set it together with the secrets below.

Repository variable `PREPROCESS_REGION` (for example `us`), and repository
secrets:

| Secret                                              | Value                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`                              | Can edit Workers scripts, R2, Queues, Hyperdrive and the Secrets Store                          |
| `CLOUDFLARE_ACCOUNT_ID`                             | Cloudflare account id                                                                           |
| `PLANETSCALE_API_TOKEN_ID`, `PLANETSCALE_API_TOKEN` | PlanetScale service token that can create and delete branches and roles on the preview database |
| `PLANETSCALE_ORGANIZATION`                          | PlanetScale organization                                                                        |
| `PLANETSCALE_DATABASE`                              | Postgres database previews branch from                                                          |
| `BETTER_AUTH_SECRET`, `AUDIT_SIGNING_KEY`           | API secrets: 32 random bytes in base64, and an Ed25519 PKCS #8 private key in base64            |
| `EMAIL_FROM`, `AUDIT_SIGNING_KEY_ID`                | Invitation sender address, and the id published with the audit public key                       |

To run a stage by hand with the same values exported:
`pnpm --filter @preprocess/infra preview:deploy pr-<n>` and
`pnpm --filter @preprocess/infra preview:destroy pr-<n>`.
