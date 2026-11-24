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

| Path                           | What it is                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/app`                     | TanStack Start product app (Cloudflare Worker)                                                                                |
| `apps/api`                     | Hono API Worker: Durable Object, queue, R2, Postgres through Hyperdrive, Workers for Platforms dispatch, model service client |
| `apps/user-worker`             | Stand-in for a customer agent Worker, dispatched through the stage's namespace                                                |
| `packages/db`                  | Drizzle schema, migrations and seed data                                                                                      |
| `packages/sdk`, `packages/cli` | Reserved for the SDK and CLI (build step 2)                                                                                   |
| `infra`                        | Alchemy stack: staging and per-PR previews                                                                                    |

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
- https://api.preprocess.localhost: the API (`/orgs`, `POST /orgs/:org/counter`,
  `POST /orgs/:org/jobs`, `/dispatch`, `POST /models/chat`).

The first run starts portless's HTTPS proxy on port 443 and trusts its local CA,
so it may ask for `sudo`. Chrome on Linux reads its own NSS store; add the CA
there once with
`certutil -d sql:$HOME/.pki/nssdb -A -t C,, -n portless -i ~/.portless/ca.pem`.

Workers, the Durable Object, the queue and R2 run in Cloudflare's local runtime,
and Hyperdrive points at local Postgres; nothing reaches Cloudflare. The local
runtime can't emulate a dispatch namespace, so locally the API reaches the user
Worker through a service binding and `/dispatch` reports
`"via": "local-service-binding"`. Deployed stages report
`"via": "dispatch-namespace"`.

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

Development and previews call the shared staging model service, never a GPU of
their own. Until that service exists, `/models/chat` is a stub: with
`MODEL_SERVICE_URL` unset it returns an OpenAI-shaped reply and calls nothing.
With it set, the API forwards to `<MODEL_SERVICE_URL>/v1/chat/completions` with
`MODEL_SERVICE_KEY` as the bearer token.

## Pull request previews

Every pull request gets its own isolated stage, `pr-<number>`, with its own
Workers, dispatch namespace, PlanetScale branch (migrated and seeded), R2
bucket, queue and Durable Objects. The URLs are posted on the pull request and
everything is destroyed when it closes. See [infra/README.md](infra/README.md).

## Checks

```sh
pnpm validate   # format, lint (with package boundaries), typecheck
pnpm test       # Vitest in the Workers runtime
pnpm build      # every Worker build
```
