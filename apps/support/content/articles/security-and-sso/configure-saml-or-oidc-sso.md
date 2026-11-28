---
title: Configure SAML or OIDC single sign-on
description:
  Connect Okta, Entra ID, Google Workspace or any SAML or OIDC identity provider
  for your organization.
updated: 2026-11-28
---

Single sign-on (SSO) lets everyone in your organization sign in through your
identity provider—such as Okta, Microsoft Entra ID, Google Workspace or any SAML
2.0 or OIDC provider. SSO is available on **Enterprise** and licensed
self-hosted installs.

Organization **Owners** manage SSO settings in **Settings → Governance → Single
sign-on**. **Admins** can view the configuration read-only.

## Connect your identity provider

Each organization supports one SAML or OIDC connection.

1. Open **Settings → Governance → Single sign-on**.
2. Choose **SAML** or **OIDC**.
3. Copy the Preprocess values shown in the setup form (callback/ACS URL and
   entity ID for SAML, or redirect URI for OIDC) into your identity provider's
   app configuration.
4. Provide your identity provider's configuration back to Preprocess:
   - **SAML:** upload your IdP metadata XML or enter the IdP metadata URL
     (Preprocess re-reads metadata URLs when certificates rotate).
   - **OIDC:** enter the issuer/discovery URL, client ID and client secret.
5. Save the connection.

## Verify email domains

Add the email domains that should sign in through your identity provider (up to
**20 domains** per organization).

1. Add each domain in **Settings → Governance → Single sign-on**.
2. Create the DNS `TXT` record Preprocess displays: host `_preprocess` with the
   `preprocess-verification=...` value.
3. Verify the domain. DNS changes can take up to 24 hours to propagate.

## Test, enforce and enable JIT provisioning

1. Run the built-in **Test sign-in** to confirm the assertion and attributes
   work end to end.
2. Turn on **JIT provisioning** if you want first-time users from verified
   domains to join your organization automatically as Members.
3. Turn on **Require SSO** once verified. When enabled, people on your verified
   domains must sign in through your identity provider instead of email links.

## Turning off SSO or plan lapse

- Turning off **Require SSO** or removing the connection lets people sign in
  with email links again.
- If an Enterprise plan or self-hosted license lapses past its grace period,
  existing SSO users keep signing in and SSO settings become read-only until
  renewed.

Every SSO configuration change is recorded in your organization's audit log.
