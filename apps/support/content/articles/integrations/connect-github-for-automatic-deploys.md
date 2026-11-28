---
title: Connect GitHub for automatic deploys
description:
  Install the Preprocess GitHub App and link repositories so every push builds
  and deploys your agents.
updated: 2026-11-28
---

Connecting GitHub lets Preprocess build and deploy an agent automatically on
every push. Owners and Admins manage GitHub connections; everyone in the
organization can view an agent's build history.

## Install the GitHub App

1. Open **Settings → Developers → GitHub**.
2. Select **Install GitHub App**.
3. On GitHub, choose the account or organization and pick the repositories
   Preprocess may read.
4. Authorize the installation. GitHub redirects you back to Preprocess with the
   account and its repositories listed.

Each GitHub installation attaches to one Preprocess organization. To connect
another GitHub account or organization, select **Add account**.

## Link a repository to an agent

1. On **Settings → Developers → GitHub**, select **Link** on a repository (or
   **Link agent**).
2. Fill in the link settings:
   - **Agent:** the agent slug. Naming a new slug creates the agent on its first
     build.
   - **Repository:** the connected repository to build from.
   - **Branch:** leave empty to deploy every branch (the agent's production
     branch deploys to production; all other branches deploy as previews), or
     enter one branch to deploy only pushes to that branch.
   - **Directory:** folder containing the agent (leave empty for the repository
     root). You can link one monorepo to multiple agents using different
     directories.
   - **Entry file:** agent entry module inside the directory (defaults to
     `src/index.ts`).
3. Save the link.

Each agent has one repository link; linking it again replaces the previous link.

## How GitHub builds work

- **Lockfile required:** Preprocess installs dependencies from a committed
  lockfile (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json` or
  `npm-shrinkwrap.json`). Builds without a lockfile fail.
- **Scoped, short-lived tokens:** Preprocess fetches your commit with a
  read-only token scoped to that repository and revokes it when the build ends.
  The token never enters the build environment or logs.
- **Serialized per agent and branch:** if you push again while a build is queued
  or running on the same agent and branch, the newer commit replaces the older
  build so stale code never deploys over newer code.

## Change repository access or unlink

- Select **Manage** next to a GitHub account to add or remove repositories,
  suspend or uninstall the App on GitHub.
- Select **Unlink** on a linked agent to stop automatic deploys. The agent and
  its existing deployments stay untouched.

## Related docs

- [Deploy from GitHub](https://docs.preprocess.com/deploy-and-operate/github-app)
- [Deployments](https://docs.preprocess.com/concepts/deployments)
