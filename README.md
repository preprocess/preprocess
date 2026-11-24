# Preprocess

Preprocess is where applied AI engineers deploy agents they write as code, and
where the rest of the company works those agents' cases.

This repository holds the product: the app, its backend Workers, shared
packages, and the Alchemy stack that deploys them to Cloudflare. It is source
available under the [Elastic License 2.0](LICENSE). `packages/sdk` and
`packages/cli` are MIT licensed (see the LICENSE file in each). Shared
libraries, including the UI, come from
[preprocess/kit](https://github.com/preprocess/kit) (MIT).

We are not accepting outside contributions yet; issues are open. See
[CONTRIBUTING.md](CONTRIBUTING.md).

| Path                           | What it is                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `apps/app`                     | TanStack Start product app (Cloudflare Worker)                                                |
| `apps/api`                     | Hono API Worker: Durable Object, queue, R2, Postgres through Hyperdrive, model service client |
| `apps/runtime`                 | Agent runtime: case Durable Objects, and agent code loaded from R2 as Dynamic Workers         |
| `apps/model-stub`              | Stub model service for `decide` and OCR in development and previews                           |
| `packages/models`              | Model client: `decide` on System One, OCR on chat completions, endpoint resolution            |
| `packages/db`                  | Drizzle schema, migrations and seed data                                                      |
| `packages/sdk`, `packages/cli` | Reserved for the SDK and CLI (build step 2)                                                   |
| `infra`                        | Alchemy stack: staging and per-PR previews                                                    |

Apps depend on packages, never the reverse. Every package has its own name,
semver version and `exports`, and `pnpm check:boundaries` (part of `pnpm lint`)
fails if a package imports from an app, so packages stay publishable.

## Local development

Needs Node 24 (`.nvmrc`), pnpm 10 and Postgres reachable as
`postgresql://preprocess:preprocess@127.0.0.1:5432`
(`scripts/setup/setup-postgres.sh` creates that role on Ubuntu). Set
`DATABASE_URL` to use another server.

```sh
pnpm dev
```

That one command installs dependencies, regenerates the local `wrangler.jsonc`
files from `infra/src/stages.ts`, creates the `preprocess_development` database,
applies migrations, loads the seed, and starts the apps behind
[portless](https://github.com/vercel-labs/portless):

- https://app.preprocess.localhost: the product app. Without WorkOS credentials
  it runs in preview mode, with a one-button sign-in and seeded scenarios.
- https://api.preprocess.localhost: the API (`/v1/orgs/{org}/…`, with its
  OpenAPI document at `/v1/openapi.json`).
- https://runtime.preprocess.localhost: the case runtime the API starts cases
  on.
- https://model-stub.preprocess.localhost: the stub model service the runtime
  calls for `decide` and the API for OCR.
- https://pdf-render.preprocess.localhost: renders PDF pages for OCR in a
  container. It needs Docker running; without it, everything else still starts
  and only PDF OCR fails.

The first run starts portless's HTTPS proxy on port 443 and trusts its local CA,
so it may ask for `sudo`. Chrome on Linux reads its own NSS store; add the CA
there once with
`certutil -d sql:$HOME/.pki/nssdb -A -t C,, -n portless -i ~/.portless/ca.pem`.

Workers, the Durable Object, the queue and R2 run in Cloudflare's local runtime,
and Hyperdrive points at local Postgres; nothing reaches Cloudflare. Agent code
runs locally the same way it runs deployed: the runtime loads each deployment's
bundle as a Dynamic Worker through its Worker Loader binding.

The first `pnpm dev` writes `apps/api/.dev.vars` with a generated
`BETTER_AUTH_SECRET` and an Ed25519 `AUDIT_SIGNING_KEY` that signs the daily
audit manifests; it is ignored by Git and kept for later runs. Invitation and
verification emails go to the local runtime's `send_email` sink, which prints
each message to the dev server's log.

## Working on kit at the same time

The app's UI and the run mode come from preprocess/kit. To try a kit change here
before it is released, check kit out beside this repository and run:

```sh
pnpm kit:link     # or KIT_DIR=<path> pnpm kit:link; rerun after each kit change
pnpm kit:unlink   # back to the published packages; do this before committing
```

A kit pull request also publishes installable builds through pkg.pr.new, which a
pull request here can use instead.

## Models

`decide` runs on Groundhog-1 through Baseten's System One API (`/v1/systemone`)
and OCR on LightOn OCR 3 4B through OpenAI chat completions
(`/v1/chat/completions`). The API reaches both through `packages/models` at
`MODEL_SERVICE_URL` with `MODEL_SERVICE_KEY` as the bearer token, or at an
organization's own registered endpoint. With neither, `decide` and OCR answer
`503 model_unavailable`; nothing falls back to a stub.

Development and previews point `MODEL_SERVICE_URL` at `apps/model-stub`, which
speaks both contracts, validates requests as strictly as the real services and
answers deterministically: fixtures first (`apps/model-stub/fixtures`), then a
lexical score for `decide` and a placeholder page for OCR. Tests can add the
request headers `x-stub-latency-ms` and `x-stub-fail` (`429`, `500`, `503`,
`timeout`) to simulate a slow or failing service; platform code never sends
them. Hosted models come later behind the same variables.

## Pull request previews

Every pull request gets its own isolated stage, `pr-<number>`, with its own
Workers, PlanetScale branch (migrated and seeded), R2 bucket, queue and Durable
Objects. The URLs are posted on the pull request and everything is destroyed
when it closes. See [infra/README.md](infra/README.md).

## Checks

```sh
pnpm validate   # format, lint (with package boundaries), typecheck
pnpm test       # Vitest in the Workers runtime
pnpm build      # every Worker build
```
