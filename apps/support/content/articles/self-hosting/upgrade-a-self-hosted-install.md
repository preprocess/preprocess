---
title: Upgrade a self-hosted install
description:
  Plan, apply and safely roll back versioned releases on your self-hosted
  Cloudflare deployment.
updated: 2026-11-28
---

Self-hosted releases are published as versioned `v*` git tags on
`preprocess/preprocess` with upgrade notes. Upgrading uses the same
`preprocess install` command you used to deploy.

## Upgrade to a new release

1. Read the target release's upgrade notes for any new optional environment
   variables or changes.
2. Preview the upgrade against your stage with `--plan`:

```sh
preprocess install --version v1.2.0 --env-file .env.selfhost --plan
```

3. Apply the upgrade:

```sh
preprocess install --version v1.2.0 --env-file .env.selfhost
```

Include `--stage selfhost-<name>` if you deployed to a named stage, and pass any
additional `--env-file` flags (such as your GitHub App credentials file) in the
same order.

## How database migrations stay safe

Every Postgres migration follows an **expand-and-contract** pattern. Before
Workers update, the installer applies pending migrations while your previous
Workers are still serving traffic. Data resources—your R2 buckets, generated
secrets and Postgres database—carry deletion protection and are never dropped
during an upgrade.

## Roll back to an earlier version

If you need to roll back Workers after an upgrade, rerun `preprocess install`
with the previous release tag:

```sh
preprocess install --version v1.1.0 --env-file .env.selfhost
```

Database migrations are forward-only and stay compatible with the previous
release, so rolling back Workers requires no manual database downgrade.

## Related docs

- [Self-hosting on Cloudflare](https://docs.preprocess.com/deploy-and-operate/self-hosting)
