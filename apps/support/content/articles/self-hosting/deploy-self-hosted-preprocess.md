---
title: Deploy self-hosted Preprocess
description:
  Install the full Preprocess platform into your own Cloudflare account using
  the CLI and Alchemy.
updated: 2026-11-28
---

Self-hosting deploys the complete Preprocess platform—web app, docs, API, case
runtime, Durable Objects, R2 buckets, queues, sandboxes and Postgres schema—into
your own Cloudflare account using Alchemy.

## Prerequisites

1. **Cloudflare Workers Paid account** with `CLOUDFLARE_ACCOUNT_ID` and a
   `CLOUDFLARE_API_TOKEN` that can manage Workers, Durable Objects, R2, Queues,
   KV, Hyperdrive, Containers, Email Sending and Secrets Store.
2. **Postgres database** reachable by Cloudflare Hyperdrive (`DATABASE_URL`),
   using an admin role that owns the database and can create roles.
3. **Sender domain on Cloudflare Email Service** in the same account for
   `EMAIL_FROM` (for example `Preprocess <invitations@example.com>`).
4. **Node.js and `npx`** on the machine or CI runner running the install.

`@preprocess/cli` npm publishing is coming soon—until it publishes, run
`preprocess install` from a local checkout of `preprocess/preprocess` (or pass
`--source <dir>`).

## Configure environment variables

Create an `.env.selfhost` file with the four required variables:

```sh
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
DATABASE_URL=postgres://...
EMAIL_FROM="Preprocess <invitations@example.com>"
```

Common optional variables include `APP_DOMAIN`, `DOCS_DOMAIN`,
`R2_LOCATION_HINT`, `BASETEN_API_KEY`, `MISTRAL_API_KEY`, `MODEL_ENDPOINTS`,
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `PREPROCESS_LICENSE_KEY` and
`POSTHOG_KEY` (to send telemetry to your own PostHog project).

**Do not set** `PREPROCESS_REGION`, `PLANETSCALE_DATABASE`, `BETTER_AUTH_SECRET`
or `AUDIT_SIGNING_KEY`. The installer generates and protects secrets
automatically and refuses to run if those variables are set.

## Preview and apply the install

1. Preview what Alchemy will create without modifying your account:

```sh
preprocess install --env-file .env.selfhost --plan
```

2. Apply the install:

```sh
preprocess install --env-file .env.selfhost
```

Pass `--stage selfhost-<name>` (for example `selfhost-prod` or
`selfhost-staging`) to run multiple installs in one Cloudflare account. When
finished, the CLI prints your `app`, `docs` and `api` URLs.

Self-hosted installs join by invitation and send no data to Preprocess. To
connect automatic GitHub deploys, run
`preprocess github-app --app-url <your-app-url>` to generate your own GitHub App
credentials.

## Related docs

- [Self-hosting on Cloudflare](https://docs.preprocess.com/deploy-and-operate/self-hosting)
- [Cloud vs. self-hosted](https://docs.preprocess.com/deploy-and-operate/cloud-vs-self-hosted)
