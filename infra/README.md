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
- `scripts/stage.ts` deploys a `pr-<number>` or `staging` stage (and destroys
  previews) and prints its outputs.
- `scripts/smoke.ts` is the end-to-end smoke test of a deployed stage; it
  deploys and runs the stub agent in `smoke-agent/`. `scripts/model-check.ts`
  runs one case per agent model, on the stub by default or on the real providers
  with `MODELS=real`.

## Stages

| Stage               | Database                                                                            | On destroy                                           |
| ------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `pr-<number>`       | Its own branch of `main`, migrated and seeded                                       | Everything removed                                   |
| `staging`           | Long-lived `staging` branch of `main`, migrated, never seeded                       | Data is protected                                    |
| `production`        | Default branch of its own database, migrated, never seeded                          | Data is protected                                    |
| `selfhost[-<name>]` | A customer's own Postgres (`DATABASE_URL`), bootstrapped and migrated, never seeded | Data is protected, and the database is never dropped |
| `development`       | Never deployed; the names `pnpm dev` uses locally                                   |                                                      |

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
  Container) and the PDF renderer (`apps/pdf-render`, a Container);
- models: the runtime's Workers AI binding (`AI`, for Qwen 3.8 27B), the
  provider keys `BASETEN_API_KEY` (runtime: Kimi, DeepSeek, decide) and
  `MISTRAL_API_KEY` (API: OCR), and the stub model service (`apps/model-stub`)
  for every model whose provider has no key. Production never gets the stub, and
  `MODEL_SERVICE_URL` replaces it with a real service. Previews and staging call
  no real provider (`callsRealModels` in `src/stages.ts`): they bind no provider
  key, no `MODEL_ENDPOINTS` and no Workers AI, so the stub answers every agent
  model, decide and OCR call. Only a staging deploy with `REAL_MODELS=true`
  binds them;
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

Region is configuration (spec 16d). Each of our stages sets `PREPROCESS_REGION`
to a key of `src/regions.ts`; the stack places the R2 bucket by that entry and
binds `PREPROCESS_REGION` on the Workers, which read it through
`@preprocess/runmode`. That binding is also the run mode: it marks the deploy as
our cloud. A self-hosted stage refuses `PREPROCESS_REGION`, binds nothing, and
places its buckets by the optional `R2_LOCATION_HINT` (for example `weur`). The
PlanetScale database (`PLANETSCALE_DATABASE`) must be created in the same
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

`plan:production` and `deploy:production` work the same way. Production adopts
the default branch of a database created by hand and only migrates it; its size
and settings are never managed by the stack. It usually also needs `APP_DOMAIN`
and `DOCS_DOMAIN`.

To drop a state record without touching the resource behind it (for example a
row left by a failed adoption), run from `infra/` with that stage's deploy
credentials exported:

```sh
pnpm exec alchemy state delete --backend cloudflare preprocess/<stage>/<resource>
```

Pass `--backend cloudflare` explicitly; the default configured backend crashes
on a filtered install.

Always read the plan first. Secrets come only from the deploy environment and
are bound as `secret_text`; Alchemy keeps the deployed values in its state,
encrypted with a key held in the account's Secrets Store, so treat the deploy
token like a production secret.

## Self-hosted installs

A customer installs Preprocess into their own Cloudflare account from this same
stack, as a `selfhost` or `selfhost-<name>` stage (spec 16).
`preprocess install` and its GitHub Action run it for them; underneath they run
`pnpm --filter @preprocess/infra selfhost:deploy <stage>` with these inputs:

| Input                                           | Value                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | The customer's account, on Workers Paid                                                           |
| `DATABASE_URL`                                  | Any Postgres Hyperdrive can reach, as a role that can create roles and owns the database          |
| `EMAIL_FROM`                                    | Invitation sender, on a domain onboarded to Cloudflare Email Service in that account              |
| `BASETEN_API_KEY` (optional)                    | Your Baseten key: Kimi K3.1 Pro, DeepSeek V4.1 Flash and `decide`                                 |
| `MISTRAL_API_KEY` (optional)                    | Your Mistral key: OCR. Without it (or an endpoint below) OCR is off                               |
| `MODEL_ENDPOINTS` (optional)                    | Your own serving URLs per model, JSON: `{"<model>": {"url", "key", "model"}}`                     |
| `MODEL_SERVICE_URL`, `MODEL_SERVICE_KEY` (opt.) | One service for every model nothing above serves. `stub` deploys fixture answers, for trying only |
| `APP_DOMAIN` (optional)                         | The app's hostname on a zone in that account; workers.dev without it                              |
| `R2_LOCATION_HINT` (optional)                   | Where R2 places the buckets                                                                       |
| `GITHUB_*` (optional)                           | The install's own GitHub App (docs/design/08-github-app.md)                                       |
| `PREPROCESS_LICENSE_KEY` (optional)             | The signed license key; without a valid one the install runs the free plan                        |

Each deploy runs `packages/db/bootstrap.sql` with passwords the stack generates
and keeps in its state, then every pending migration as `preprocess_migrator`,
before any Worker is updated. Hyperdrive logs in as `preprocess_app` and
`preprocess_system`, so row-level security applies. `BETTER_AUTH_SECRET`,
`AUDIT_SIGNING_KEY` and its id, and the secrets master key are generated once.
Qwen 3.8 27B runs on Workers AI in the install's own account, billed by
Cloudflare to that account; every other model needs its provider key or an
endpoint, or it is unavailable. The account's state store is created or upgraded
as part of the install. `selfhost:plan <stage>` prints the plan without applying
it.

## Continuous deployment

`.github/workflows/deploy.yml` runs on every push to `main`, one push at a time:

1. **CI** (`ci.yml`): validate, build and test.
2. **Deploy staging** (`staging:deploy`) in the `staging` environment.
3. **Staging smoke test** (`smoke`): the API's health check, the app's sign-in
   page, sign-in through the app's origin (signing up the stage's smoke-test
   user on the first run) and reading the session back, then deploying the stub
   agent in `smoke-agent/` to the smoke-test organization and running one case
   to completion. The user's password is derived from the stage's
   `BETTER_AUTH_SECRET` and its address is on `EMAIL_FROM`'s domain, so the test
   needs no secret of its own. The case must get the stub's fixture reply, so a
   stage that reached a real provider fails here. Then `model-check` runs one
   case per agent model on the stub, each with an OCR'd invoice and a decide
   call, and writes each case's charge to the job summary.
4. **Promote to production**: mints a token for the `preprocess-deploy` GitHub
   App and starts `deploy-preprocess.yml` in preprocess/internal with the
   commit's sha. Internal holds production's configuration, checks the sha is on
   `main` and passed "Staging smoke test", and runs `deploy:production`.

**The full real-model pass** runs only by hand: start "Deploy" on `main` with
`real_models` checked. That run deploys staging with the provider keys, runs the
smoke test, then `model-check` with `MODELS=real` (every agent model, decide and
OCR on Baseten, Workers AI and Mistral) in its own "Real-model pass" job, and
promotes nothing to production. The next push to `main` puts staging back on the
stub.

A job whose secrets aren't set reports "skipped" with the missing names and
stays green. The smoke test runs only after a real staging deploy, so its check
exists only for commits that passed it.

**Rollback** is in internal:
`gh workflow run deploy-preprocess.yml -R preprocess/internal -f rollback=true`
redeploys the previous good commit. It never reverses migrations, which is why
they are expand and contract (`AGENTS.md`).

`v*` tags are self-hosted releases and deploy nothing of ours.

## Pull request previews

`.github/workflows/preview.yml` runs on every same-repository pull request: it
deploys `pr-<number>`, runs `scripts/smoke.ts` against it, and posts one comment
with the URLs, updated on each push. When the pull request closes it empties the
stage's R2 buckets, destroys the stage and updates the comment. Pull requests
from forks get no secrets and no preview.

If a teardown fails, dispatch the workflow with the pull request's number to
destroy its stage again (it refuses a pull request that is still open):

```sh
gh workflow run preview.yml --ref main -f pr=<n>
```

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

## Container registry

Cloudflare's container registry holds at most 50 GB per account, counts every
stage's images, and reports no usage. The build sandbox, PDF renderer and case
sandbox preset images publish to one repository each, shared by every stage
(`imageRepositories` in `src/stages.ts`), tagged by the hash of their build
inputs. `apps/builder/Dockerfile.dockerignore`,
`apps/pdf-render/Dockerfile.dockerignore` and
`apps/runtime/sandbox/Dockerfile.dockerignore` keep each hash to the files its
image copies, so a stage whose image inputs are unchanged reuses the published
image without building or pushing anything. The four presets share one
Dockerfile, so each gets its own repository rather than relying on the build
argument to tell their tags apart.

- **Preview teardown** deletes the destroyed stage's images: its old per-PR
  repositories, and, unless the pull request merged, the shared images only it
  referenced.
- **`.github/workflows/registry.yml`** runs daily: it deletes the images
  rollback no longer needs (closed previews' repositories, and images older than
  two days in the shared repositories and in staging's and production's
  repositories from before they were shared), then estimates usage. It keeps
  every image used by a Worker's newest 10 versions or by its current deployment
  (both versions of a gradual one), whatever their age. Older versions' images
  can go: rollback runs through Alchemy, which rebuilds a missing image.
- **Usage**: `pnpm --filter @preprocess/infra registry usage` walks every
  repository, tag and manifest and adds up the blobs, each counted once. Its
  first summary line is always `REGISTRY_USAGE_GB=<n>`. It adds a warning
  annotation at 35 GB and fails at 42 GB, so the daily Registry run fails there;
  the staging deploy runs it too, without blocking the deploy.

A delete removes tags and manifests at once, but Cloudflare documents no garbage
collection of the blobs underneath, and a prepared image's `btrfs-chain`
artifact refuses deletion (409). Treat the estimate as what the registry holds,
not what counts against the cap.
