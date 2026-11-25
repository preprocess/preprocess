# @preprocess/cli

The `preprocess` command-line interface (mvp-surface.md): `deploy` and its
siblings for agents, and `install` and `github-app` for self-hosting.

## deploy

```sh
export PREPROCESS_API_URL=https://api.preprocess.localhost  # your Preprocess API
export PREPROCESS_ORG=org_…
export PREPROCESS_API_KEY=pp_…                               # an organization API key
preprocess deploy [entry]                                    # entry defaults to src/index.ts
```

It bundles the agent (an `agent()` from `@preprocess/sdk` as the module's
default export) into one ES module with esbuild, and uploads it with the git
branch and commit of the checkout. The agent's name is `--agent`, or the
`package.json` name without its scope. A deploy from the agent's production
branch (`main` unless changed) is promoted once every secret it declares is
granted; until then it waits, and the command says which grants are missing. Any
other branch makes a preview.

The API key is read only from `PREPROCESS_API_KEY`, so it never lands in shell
history.

A `preprocess.config.json` beside the project's `package.json` (or beside the
entry) is bundled with the agent. Its `settings` win over the values set in
`agent({...})`, and the deploy prints a warning for each inline value it
overrides and each group the agent names that its `groups` list leaves out.

## install

```sh
export CLOUDFLARE_API_TOKEN=…   CLOUDFLARE_ACCOUNT_ID=…      # your account, on Workers Paid
export DATABASE_URL=postgres://…                            # any Postgres Hyperdrive can reach
export EMAIL_FROM="Preprocess <invites@example.com>"        # a domain onboarded to Email Service
export MODEL_SERVICE_URL=…      MODEL_SERVICE_KEY=…          # our hosted models or your own
preprocess install [--version <tag> | --source <dir>] [--stage selfhost] [--plan]
```

`install` installs or upgrades self-hosted Preprocess in your own Cloudflare
account (spec 16). It downloads the release (the latest unless you pass
`--version`, or uses a checkout with `--source`), then runs the same Alchemy
stack our cloud deploys from as your `selfhost` stage. That stack creates every
Worker, bucket, queue, Durable Object, container and Hyperdrive config, runs
bootstrap and migrations on your Postgres, and generates the install's own
secrets. Running it again with a newer `--version` upgrades the install.
`--plan` prints what would change and changes nothing. Docker must be running,
because it builds the stack's container images.

Inputs come from the environment, or from `--env-file` (repeatable, and later
files win). Never set `PREPROCESS_REGION`: it marks a deploy as our cloud.
`APP_DOMAIN`, `R2_LOCATION_HINT` and the GitHub App's values are optional. The
full list is in `infra/README.md`. Set `MODEL_SERVICE_URL=stub` only to try
Preprocess with fixture answers.

## github-app

```sh
preprocess github-app --app-url https://preprocess.example.com [--owner <github-org>]
```

`github-app` registers your install's own GitHub App through GitHub's manifest
flow, with the permissions, events and URLs described in
`docs/design/08-github-app.md`. Open the local page it prints in a browser that
is signed in to GitHub. When GitHub hands the App back, the command writes its
six `GITHUB_*` values to `.env.github-app`, which only you can read, with the
private key already in PKCS #8. Pass that file to
`preprocess install --env-file`, or copy the values into your CI's secrets, then
delete it.

## GitHub Action

`action.yml` runs the same command in GitHub Actions. Install the agent
project's dependencies first; the Action bundles from them.

```yaml
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - uses: preprocess/preprocess/packages/cli@main
        with:
          api-url: ${{ vars.PREPROCESS_API_URL }}
          org: ${{ vars.PREPROCESS_ORG }}
          api-key: ${{ secrets.PREPROCESS_API_KEY }}
```

Pushes to the agent's production branch deploy to production once its grants are
in place; pull requests and other branches make previews, named after the pull
request's head branch.

`install/action.yml` runs `preprocess install` from the release the Action is
pinned to, so upgrading means changing the tag:

```yaml
on: workflow_dispatch
jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: preprocess/preprocess/packages/cli/install@v0.2.0
        with:
          cloudflare-api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          cloudflare-account-id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          database-url: ${{ secrets.DATABASE_URL }}
          email-from: ${{ vars.EMAIL_FROM }}
          model-service-url: ${{ vars.MODEL_SERVICE_URL }}
          model-service-key: ${{ secrets.MODEL_SERVICE_KEY }}
```

`plan: "true"` prints the plan only. The other inputs (`stage`, `app-domain`,
`r2-location-hint` and the six `github-*` values) are listed in the Action.

Unlike the rest of this repository, which is under the Elastic License 2.0,
everything in this directory is MIT licensed (see LICENSE).
