---
title: Invite team members and manage roles
description:
  Add people to your organization, change their organization role and remove
  members.
updated: 2026-11-28
---

Organization **roles** control who can administer your organization, while
**groups** control who can work an agent's cases. Manage organization membership
and roles in **Settings → Organization → Members**.

## Invite a team member

Owners and Admins can send invitations.

1. Open **Settings → Organization → Members**.
2. Select **Invite** and enter the person's email address.
3. Choose a role: **Member**, **Admin** or **Owner** (only Owners can invite
   another Owner).
4. Send the invitation. The invitee appears as pending until they accept the
   link in their email.

## Organization roles

Every member has one organization role:

| Role       | What they can do                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Owner**  | Full control: everything an Admin can do, plus Billing, SSO and directory sync configuration, shortening retention periods, deleting individual cases and deleting the organization.                               |
| **Admin**  | Manage members, groups, agent grants, secrets, API keys, webhooks, settings and guardrails; approve guardrail requests; deploy, promote, roll back and archive agents; view every case and assign people to cases. |
| **Member** | Access only what their agent groups grant. Deploying, promoting and rolling back require membership in the **Developers** group.                                                                                   |

Organization roles don't automatically grant operator permissions on agents.
Even an Owner or Admin must belong to an agent's **Operator** group (or the
**Developers** group) to edit answers, rerun, approve or complete cases. See
[Manage groups and agent access](/security-and-sso/manage-groups-and-agent-access).

## Change a role or remove a member

1. Open **Settings → Organization → Members**.
2. Open the action menu on the member's row and select **Change role** or
   **Remove**.

Only an Owner can change another Owner's role or remove an Owner.

## How seats affect billing

Preprocess counts **active developer and operator seats**—people who belong to
Developers or an agent's Operator group and do active work in a month. Viewers
are always free.

- **Free plan:** includes up to 3 active developer or operator seats.
- **Team and Enterprise:** $16 per active seat per month, billed at month end.

See
[Plans, pricing and Free plan limits](/billing-and-credits/plans-pricing-and-free-limits)
and the
[Groups and access docs](https://docs.preprocess.com/concepts/groups-and-access).
