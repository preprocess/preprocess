# Preprocess agent guide

Read README.md first. More specific `AGENTS.md` files (`apps/app`) override or
extend these rules within their directories.

## Repository boundaries

- Applications (`apps/*`) may depend on packages (`packages/*`); packages never
  depend on or import from apps. `pnpm check:boundaries` enforces it.
- Every package has its own name, semver version and `exports`. Libraries shared
  with other Preprocess, Inc. products (UI, auth, run mode, logging, config)
  live in [preprocess/kit](https://github.com/preprocess/kit), not here. Use
  `pnpm kit:link` to work on both together.
- Web applications use TanStack Start and deploy as Cloudflare Workers. The
  backend is Hono on Workers, Drizzle on Postgres through Hyperdrive.
- Licenses: the repository is Elastic License 2.0; `packages/sdk` and
  `packages/cli` are MIT. There is no `ee/` directory.
- We are not accepting outside contributions yet; a workflow closes pull
  requests from non-members. See CONTRIBUTING.md, which also records the
  versioning rules (semver for the SDK and CLI, `/v1` deprecation policy).

## Infrastructure

`infra/` is an Alchemy stack and the source of truth for Cloudflare resources.
Declare every Worker, binding, var, secret, route and domain in
`infra/src/stages.ts` and `infra/alchemy.run.ts`, never in hand-edited wrangler
config or the dashboard. Region is configuration: every deploy of our cloud
names it with `PREPROCESS_REGION`, `infra/src/regions.ts` maps it to provider
locations, and code reads it only through `@preprocess/runmode`. Never hard-code
a region. Self-hosted installs are `selfhost` stages of the same stack and never
set `PREPROCESS_REGION`.

Portability (spec 16): product code uses only what the self-hosted installer
creates in a customer's own Cloudflare account. Nothing may depend on
preprocess/internal, on our account's resources, or on Cloudflare features a
customer's account can't get; our hosted extras stay behind run mode. Review
enforces this rule. `apps/*/wrangler.jsonc` is generated for local development;
`pnpm lint` fails if it drifts. Deploys run through `infra/`, never
`wrangler deploy`.

Every push to `main` deploys staging, runs the staging smoke test
(`infra/scripts/smoke.ts`), and then ships the same commit to production with no
manual step (`.github/workflows/deploy.yml`). Treat a merge as a production
deploy. `v*` tags are self-hosted releases only: versioned, with upgrade notes,
and they deploy nothing of ours.

## Migrations

Expand and contract. Each deploy applies `packages/db/migrations` while the
previous Workers still serve, and a rollback runs the previous Workers on the
newer schema, so every migration must work with both the old and the new code.

- **Expand** in one release: add tables, nullable columns, or columns with a
  default; add indexes; backfill. The new code may use them, and the old code
  must not break because they exist.
- **Contract** in a later release, once no deployed code reads or writes the old
  shape: drop, rename, retype, or make NOT NULL. Rename by adding the new
  column, writing both, backfilling, switching reads, and only then dropping the
  old one.
- Never edit or delete a migration once it is on `main`; add a new one.
- `pnpm check:migrations` (run on every pull request) fails on edited or deleted
  migrations and on contracting statements. A contract migration must say why it
  is safe on its own line: `-- contract: <reason>`, naming the release that
  stopped using what it removes.

## Design system

The app uses Fluid Functionalism from `@preprocess/ui` (preprocess/kit): Base UI
flavor, `pill` shape, Lucide icons through `@preprocess/ui/lib/icons` only (lint
rejects `lucide-react` elsewhere), and the spring tokens in
`@preprocess/ui/lib/springs`. Use the Fluid component when one exists; compose
or wrap it rather than editing vendored files (kit's
`packages/ui/registry-inventory.json` lists them). Text uses the six type roles,
three weights and two colors. Overflow panes use `ScrollArea`. Forms use
`InlineValidation` and `LoadingButton`.

## Development rules

- Never use production customer data in development or previews.
- Keep generated output and credentials out of Git.
- Avoid speculative abstractions, barrel files and dependency-heavy frameworks.
- Keep each commit focused and use Conventional Commits.

## Tests

Vitest runs inside the Workers runtime through `@cloudflare/vitest-plugin`, so
tests exercise real Durable Objects, R2 and queues (`pnpm test`). Tests are
required for any change touching tenant isolation, auth, billing, license or
entitlements, and optional elsewhere. A Worker's tests live in its `test/`
directory with a `vitest.config.ts` beside its `package.json`;
`apps/api/test/tenant-isolation.test.ts` is the example.

## Verification

Check UI changes in the running app with `pnpm dev` and the seeded scenarios.
Run `pnpm validate` and `pnpm test` before handoff, and `pnpm build` for changes
to deployable code or configuration.
