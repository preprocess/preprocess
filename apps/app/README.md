# Product application

TanStack Start product application, deployed as a Cloudflare Worker.

The app is AuthKit-protected end to end via
`@workos/authkit-tanstack-react-start`. Unauthenticated requests redirect to
`/api/auth/sign-in`. Inbox, cases, and the case room load seeded data in
development (see `AGENTS.md`).

## Auth setup

1. Copy `.dev.vars.example` to `.dev.vars` and fill WorkOS values.
2. In the [WorkOS Redirects](https://dashboard.workos.com/redirects) page set:
   - **Redirect URI:** `https://app.preprocess.localhost/api/auth/callback`
   - **Sign-in endpoint:** `https://app.preprocess.localhost/api/auth/sign-in`
   - **Sign-out redirect:** `https://app.preprocess.localhost/`
3. For deployed environments, provide the same values (`WORKOS_CLIENT_ID`,
   `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI`) in the
   Alchemy deploy environment (`infra/README.md`) and point Redirects at the
   environment host.

## Commands

`pnpm dev` at the repository root runs the app with the rest of the local
environment at `https://app.preprocess.localhost` (see the root README). The
package's own `dev` script is plain `vite dev`.

## Preview mode

With `PREPROCESS_PREVIEW=true` (the root `pnpm dev` sets it when no WorkOS
credentials are present), `vite dev` swaps WorkOS AuthKit for a one-button
preview sign-in (`src/preview`) and serves the seeded scenarios. Two guards keep
it out of deployable Workers: `vite.config.ts` refuses it for anything but
`vite dev`, and `src/preview/session.server.ts` refuses to run outside dev.
Every Worker build also fails if the preview sign-in's cookie name appears in
its output.

```sh
pnpm --filter @preprocess/app dev
pnpm --filter @preprocess/app dev:vite
pnpm --filter @preprocess/app lint
pnpm --filter @preprocess/app typecheck
pnpm --filter @preprocess/app build
```

`build` verifies the development and staging Worker manifests. To produce one
deployable environment artifact directly, run the corresponding
`build:development` or `build:staging` package script. The Cloudflare Vite
plugin selects staging through `CLOUDFLARE_ENV` at build time. The aggregate
`build` command is a verification pass and leaves the development artifact in
`dist`; deployment automation must run the explicit environment script
immediately before deploying.
