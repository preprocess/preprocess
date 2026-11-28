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

Organization **Owners** issue and revoke SCIM bearer tokens (up to **5 tokens**
per organization; each token is shown once at creation). **Admins** can view
sync status and existing tokens.

1. Create a SCIM bearer token through your organization's SCIM settings endpoint
   (`/v1/orgs/{org}/scim/...`). A dedicated directory-sync settings page in the
   app UI is coming soon.
2. In your identity provider's SCIM provisioning settings, enter:
   - **SCIM base URL:** `https://<your-app-origin>/api/auth/scim/v2`
   - **Authentication:** Bearer token (paste the token you created)
3. Enable user and group push in your identity provider.

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
