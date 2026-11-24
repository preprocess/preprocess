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

| Stage         | What it deploys                                             |
| ------------- | ----------------------------------------------------------- |
| `staging`     | App Worker on workers.dev                                   |
| `pr-<number>` | App Worker plus the full backend, isolated per pull request |
| `development` | Never deployed; the names `pnpm dev` uses locally           |

A preview stage gets its own API Worker (with the `Counter` Durable Object
namespace), R2 bucket, queue and consumer, dispatch namespace with the user
Worker, Hyperdrive config, and PlanetScale Postgres branch `pr-<number>` forked
from the database's `main`, with `packages/db/migrations` applied and
`packages/db/seed.sql` imported. Everything is served on workers.dev, so a
preview needs no DNS. `destroy` removes all of it, the PlanetScale branch
included. Staging gets the backend once its PlanetScale database exists (build
step 1). Production deployment config for our cloud is private and is not part
of this repository; a self-hosted install deploys its own stages.

The app's WorkOS secrets are required on staging and optional on previews, where
sign-in stays unavailable until Better Auth replaces WorkOS.

## Regions

Region is configuration (spec 16d). Each deploy sets `PREPROCESS_REGION` to a
key of `src/regions.ts`; the stack places the R2 bucket by that entry and binds
`PREPROCESS_REGION` on the Workers, which read it through `@preprocess/runmode`.
The PlanetScale database (`PLANETSCALE_DATABASE`) must be created in the same
region, because branches live where their database does. We launch in `us` only;
adding a region adds an entry and a database.

## Deploy staging

Once per account, bootstrap the state store from a laptop:
`pnpm --filter @preprocess/infra exec alchemy state bootstrap`. CI refuses to
create it.

```sh
cp infra/.env.example infra/.env.staging   # fill it in; ignored by Git
pnpm --filter @preprocess/infra plan:staging -- --env-file .env.staging
pnpm --filter @preprocess/infra deploy:staging -- --env-file .env.staging
```

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

Repository variable `PREPROCESS_REGION` (for example `us`), and repository
secrets:

| Secret                                              | Value                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`                              | Can edit Workers scripts, Workers for Platforms, R2, Queues, Hyperdrive and the Secrets Store   |
| `CLOUDFLARE_ACCOUNT_ID`                             | Cloudflare account id                                                                           |
| `PLANETSCALE_API_TOKEN_ID`, `PLANETSCALE_API_TOKEN` | PlanetScale service token that can create and delete branches and roles on the preview database |
| `PLANETSCALE_ORGANIZATION`                          | PlanetScale organization                                                                        |
| `PLANETSCALE_DATABASE`                              | Postgres database previews branch from                                                          |

To run a stage by hand with the same values exported:
`pnpm --filter @preprocess/infra preview:deploy pr-<n>` and
`pnpm --filter @preprocess/infra preview:destroy pr-<n>`.
