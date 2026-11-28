---
title: Configure support links on a self-hosted install
description:
  Understand how the Help menu behaves on self-hosted installs and where
  documentation and support links point.
updated: 2026-11-28
---

Self-hosted deployments don't deploy the hosted help center Worker, and **no
support data ever leaves your Cloudflare account**.

## What the Help menu shows on self-hosted installs

In the bottom-left sidebar of the Preprocess app, the **Help** menu adapts
automatically for self-hosted stages:

- **Documentation:** points to your install's own deployed docs Worker
  (`DOCS_URL`). Set `DOCS_DOMAIN` in your `.env.selfhost` file to serve it on a
  custom hostname instead of `workers.dev`.
- **Status:** hidden on self-hosted stages (the hosted status page link is only
  set on Preprocess Cloud).
- **Contact support:** opens an email to `support@preprocess.com` so licensed
  self-hosted teams can reach Preprocess Support directly.

## Custom internal support URLs (coming soon)

Configuring a custom URL for **Help → Contact support** (for example pointing
your team to an internal IT service desk or wiki instead of Preprocess Support)
is **coming soon**. Once available, you'll be able to override the support
destination in your self-hosted configuration.

## Getting help on a self-hosted install

- **Licensed installs:** email `support@preprocess.com` or browse
  `https://support.preprocess.com`. Include your release tag (`v*`), relevant
  Worker logs and whether the issue reproduces on a clean test case.
- **Unlicensed installs:** use the documentation deployed with your install or
  `https://docs.preprocess.com`.

## Related docs

- [Self-hosting on Cloudflare](https://docs.preprocess.com/deploy-and-operate/self-hosting)
- [Cloud vs. self-hosted](https://docs.preprocess.com/deploy-and-operate/cloud-vs-self-hosted)
