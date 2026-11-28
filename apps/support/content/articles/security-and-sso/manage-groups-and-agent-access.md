---
title: Manage groups and agent access
description:
  Organize people into groups and grant Operator or Viewer access to specific
  agents.
updated: 2026-11-28
---

Preprocess separates organization administration from agent access: **roles**
(`Owner`, `Admin`, `Member`) govern the organization, while **groups** govern
agents. Nobody receives direct per-user permissions on an agent.

## Create a group and add members

Owners and Admins manage groups in **Settings → Organization → Groups**.

1. Open **Settings → Organization → Groups**.
2. Create a group with a display name, description and unique **slug** (for
   example `accounts-payable` or `finance-leads`). Agent code references this
   slug for `ctx.waitOn()`, `@slug` tags and approval gates.
3. Add members to the group.

### The built-in Developers group

Every organization includes a built-in **Developers** group. Its members can
deploy, promote, roll back, change agent settings, run evals and work cases
across **every** agent. Developers requires no per-agent grants and can't be
deleted.

## Grant a group access to an agent

1. Open **Agents → [your agent] → Access**.
2. Add the group and choose an access level:

| Grant        | What group members can do on that agent                                     |
| ------------ | --------------------------------------------------------------------------- |
| **Operator** | Start, edit and confirm answers, rerun, complete, cancel and approve cases. |
| **Viewer**   | Read the agent's cases and history without making changes.                  |

If someone belongs to multiple groups on the same agent, their highest grant
applies. Owners and Admins can view and assign any case for oversight, but still
need an **Operator** grant (or **Developers**) to edit answers, rerun, approve
or complete cases.

## How live deployments protect groups

- Naming an unknown group slug in agent code fails the deploy immediately.
- Naming an existing group without the required grant places the deployment in
  `waiting` and opens a guardrail request for an Owner or Admin.
- While any live deployment references a group, that group can't be deleted and
  its grant can't be lowered below what the code requires. Deploy code that
  stops referencing the group first.

Run `npx preprocess groups pull` to sync your organization's group slugs into
`preprocess.config.json`.

## Related docs

- [Groups and access](https://docs.preprocess.com/concepts/groups-and-access)
