---
title: Activate and renew a license key
description:
  Install an offline license key on a self-hosted deployment and understand the
  30-day grace period.
updated: 2026-11-28
---

A self-hosted install runs the free product without a license. Installing a
signed **offline Ed25519 license key** unlocks paid features—SSO, SCIM directory
sync, synced groups, custom roles, audit log export and custom sandbox
environments—and sets your install's seat limit.

Keys are valid for **one year** and verified locally inside your Cloudflare
account. There is no license server, and your install never contacts Preprocess
to check its license.

## Activate or renew a license key

You can install a key in either of two ways:

- **In the app (recommended):** as an organization **Owner**, open **Settings →
  Self-hosted → License** and paste the license key. It takes effect on the next
  request with no redeploy or restart.
- **Via environment variable:** set `PREPROCESS_LICENSE_KEY` in your
  `.env.selfhost` file and re-run `preprocess install`.

A key pasted in **Settings → Self-hosted → License** takes precedence over
`PREPROCESS_LICENSE_KEY`.

## What happens when a key expires

**Nothing is deleted when a license ends.** Your agents, cases, deployments,
files, logs and audit log remain in your Cloudflare account and Postgres
database.

### 30-day grace period

When your expiry date passes, your install enters a **30-day grace period**. All
paid features keep working, and Owners and Admins see a warning in the sidebar
and on **Settings → Self-hosted → License** showing when grace ends. Members see
nothing.

### After grace ends

If not renewed after 30 days, paid features turn off and the install continues
on the free feature set:

- **Data and audit log:** everything stays readable and exportable via the API;
  audit log export turns off, while the audit log itself keeps recording.
- **SSO:** existing SSO users keep signing in; SSO settings become read-only.
- **Directory sync:** SCIM sync stops; previously synced users and groups stay
  as they are.
- **Custom sandbox environments:** agents using `sandbox.setup` pause for new
  cases; all other agents keep running.
- **Seats:** the license's seat limit no longer applies.

Pasting a renewed key turns all paid features back on and resumes paused agents
immediately. To renew before expiry,
[contact support](/getting-started/contact-support-and-response-times).

## Related docs

- [When a license ends](https://docs.preprocess.com/deploy-and-operate/license-end)
