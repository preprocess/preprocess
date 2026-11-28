---
title: Deploy your first agent
description:
  Publish an agent to Preprocess using the CLI or GitHub App and start your
  first case.
updated: 2026-11-28
---

There is no "New agent" button in the Preprocess app. Deploying code under a new
slug creates the agent automatically.

## Prerequisites

- An organization on Preprocess with a payment method on file (required before
  agents can run on Preprocess Cloud, including on the Free plan).
- An **Owner**, **Admin** or **Developers** group membership (or an organization
  API key).
- An agent entry module exporting `agent({ ... })` from `@preprocess/sdk` (by
  default `src/index.ts`).

## Option 1: deploy from the CLI

1. Sign in from your terminal:

```sh
npx preprocess login --api https://app.preprocess.com
```

2. From your agent's directory, deploy:

```sh
npx preprocess deploy
```

`@preprocess/cli` npm publishing is coming soon—until then, run the CLI from a
checkout of the `preprocess/preprocess` repository.

By default, Preprocess derives the agent slug from your `package.json` name
(without any scope). Pass `--agent <slug>` to choose a different slug.

## Option 2: deploy automatically from GitHub

If you want every push to build and deploy without running the CLI, connect your
repository in **Settings → Developers → GitHub** and link it to an agent. See
[Connect GitHub for automatic deploys](/integrations/connect-github-for-automatic-deploys).

## What happens when you deploy

- **Production vs. preview:** deploying from your agent's production branch
  (`main` by default) creates a production deployment and promotes it
  immediately. Deploying from any other branch—or outside a git
  repository—creates an isolated preview deployment.
- **Guardrail checks:** if your agent declares a secret, MCP server, outbound
  network host, group grant or sandbox size that isn't approved yet, the
  deployment succeeds with status **waiting** and opens a guardrail request in
  **Settings → Governance → Guardrails**. Once an Owner or Admin approves it, a
  production deployment promotes automatically.
- **Custom sandboxes:** if your agent declares `sandbox.setup`, Preprocess
  builds the custom environment layer before the deployment serves cases.

## Start your first case

Once the deployment is ready, open **Agents → [your agent]** in the app and
select **Add** (or call `POST /v1/orgs/{org}/cases`).

## Related docs

- [Quickstart](https://docs.preprocess.com/quickstart)
- [CLI deploy reference](https://docs.preprocess.com/cli/deploy)
- [Deployments concept guide](https://docs.preprocess.com/concepts/deployments)
