# Product application

TanStack Start product application, deployed as a Cloudflare Worker.

Every page needs a session except sign-in, sign-up and accepting an invitation.
Better Auth runs in the API Worker; the app forwards `/api/auth/*` and `/v1/*`
to it through the `API` service binding, so cookies stay on the app's origin.
Inbox, cases, and the case room load seeded data in development (see
`AGENTS.md`).

Under `pnpm dev`, verification and invitation emails go to the API's local
`send_email` sink: the API's log prints the path of each message file.

## Commands

`pnpm dev` at the repository root runs the app with the rest of the local
environment at `https://app.preprocess.localhost` (see the root README). The
package's own `dev` script is plain `vite dev`.

```sh
pnpm --filter @preprocess/app dev
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
