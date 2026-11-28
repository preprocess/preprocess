---
title: Set up SCIM directory sync
description:
  Provision and deprovision organization members and groups automatically from
  your identity provider using SCIM.
updated: 2026-11-28
---

Directory sync uses **SCIM 2.0** so your identity provider (such as Okta or
Microsoft Entra ID) automatically adds members, removes departing employees and
keeps agent groups in sync. SCIM directory sync is available on **Enterprise**
and licensed self-hosted installs.

## Connect your identity provider

Organization **Owners** manage directory sync in **Settings → Governance →
Directory sync** (**Admins** can view the connection, tokens and synced groups
read-only).

1. Open **Settings → Governance → Directory sync**.
2. Under **Connection**, copy the **Base URL**
   (`https://<your-app-origin>/api/auth/scim/v2`).
3. Generate a **Bearer token** and copy it immediately—it won't be shown again.
4. In your identity provider's SCIM provisioning settings, paste the **Base
   URL** and **Bearer token**, then assign people and groups to the app.

Once your identity provider syncs, synced people and groups appear under
**Synced from your identity provider**.

### Rotate or revoke a SCIM token

Open **Token actions** next to **Bearer token** in **Settings → Governance →
Directory sync**:

- **Regenerate:** stops the current token immediately and issues a new one. Your
  identity provider won't sync until you paste in the new token.
- **Revoke:** disables syncing until you generate a new token. People and groups
  already synced stay as they are.

## How SCIM users map to Preprocess

- **Active SCIM users** are added to your organization with the **Member** role.
- **Inactive or deleted SCIM users** are removed from the organization
  automatically. If the person belongs to no other organization, their account
  is deactivated and all active sessions (including CLI device sessions) are
  revoked immediately.
- **Owners are protected:** SCIM doesn't remove an organization **Owner**. To
  remove an Owner, change their role or remove them in **Settings → Organization
  → Members**.

## How SCIM groups map to Preprocess

- Each synced SCIM group creates a matching Preprocess group whose membership
  follows your directory.
- **Safe group deletion:** if a group is deleted in your identity provider,
  Preprocess keeps the group and its agent grants intact rather than breaking
  live deployments. The group is flagged as removed from directory sync and
  Owners, Admins and Developers receive an email to review it. Pushing a group
  with the same external ID re-links it automatically.

Every SCIM write and resulting membership change is recorded in your
organization's audit log.

## Related articles

- [Configure SAML or OIDC single sign-on](/security-and-sso/configure-saml-or-oidc-sso)
- [Manage groups and agent access](/security-and-sso/manage-groups-and-agent-access)
