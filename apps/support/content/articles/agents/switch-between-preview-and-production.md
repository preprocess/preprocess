---
title: Promote a preview deployment and roll back
description:
  Test changes on preview deployments, ship them to production and roll back to
  an earlier release.
updated: 2026-11-28
---

Every deploy creates an immutable deployment snapshot pinned to a git branch and
commit. **Production** serves live cases by default, while **previews** isolate
branch testing so you can verify changes safely before merging.

## How previews and production work

- **Production branch (`main` by default):** every deploy from the production
  branch creates a production deployment and promotes it automatically once all
  guardrail checks and sandbox builds pass.
- **Other branches:** deploying from any other branch creates a **preview**
  deployment. Preview deployments never receive live production traffic—cases
  only run on a preview when you explicitly target its `dep_...` deployment ID
  (or when a schedule sets `previews: true`).

## Move changes from preview to production

Preprocess enforces branch hygiene: **only a deployment from the production
branch can be promoted to production** (attempting to promote a preview
deployment is refused).

To ship changes you tested in a preview:

1. Verify your preview deployment by running test cases or an eval suite
   (`npx preprocess evals run <suite>`) against its `dep_...` ID.
2. Merge your branch into the agent's production branch (`main`).
3. Push (if using the GitHub App) or run `npx preprocess deploy` from the
   production branch. Preprocess builds and promotes the new production
   deployment automatically.

## Roll back to an earlier production deployment

Rolling back promotes an earlier production deployment without running a new
build. Owners, Admins, members of the **Developers** group and organization API
keys can roll back.

### In the app

1. Open **Agents → [your agent] → Deployments**.
2. Find the earlier production deployment you want to restore.
3. Select **Promote**.

### From the CLI

Roll back to the deployment that served production immediately before the
current one:

```sh
npx preprocess rollback
```

Or promote a specific production deployment by ID:

```sh
npx preprocess promote dep_...
```

## What stays the same on promote or rollback

- **In-flight cases don't move.** Every case stays pinned to the deployment it
  started on, including across reruns.
- **Secrets and grants don't revert.** Rollback moves only the agent's
  code—revoked grants and rotated secrets remain in their current state.
- **Dashboard overrides clear.** Promoting a deployment clears temporary
  dashboard overrides on the agent so code is the source of truth again.

## Related docs

- [Promote and roll back in the CLI](https://docs.preprocess.com/cli/promote-and-rollback)
- [Deployments](https://docs.preprocess.com/concepts/deployments)
- [Environments and regions](https://docs.preprocess.com/deploy-and-operate/environments-and-regions)
