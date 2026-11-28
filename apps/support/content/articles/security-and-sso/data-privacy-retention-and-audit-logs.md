---
title: Data privacy, retention and audit logs
description:
  Understand tenant isolation, configure data retention periods, review audit
  logs and see how support data is handled.
updated: 2026-11-28
---

Preprocess isolates every organization's data across database rows, case
execution and file storage, encrypts secrets and MCP tokens per organization and
records security-relevant actions in a tamper-evident audit log.

## Configure data retention

By default, organizations keep documents, run captures, run logs and cases
forever. Organization **Owners** can set retention periods in **Settings →
Governance → Retention** (Admins can view them read-only):

1. Open **Settings → Governance → Retention**.
2. Choose a retention period for each category—**Documents**, **Run captures**,
   **Run logs** or **Cases**—using a preset (**30**, **90** or **365 days**), a
   custom number of days (minimum **7 days** after a case closes) or
   **Forever**.
3. Save your changes.

A daily sweep purges expired data and writes a retention event to your audit
log. Owners can also delete individual cases by hand.

## Audit log and observability export

- **Audit log:** view the hash-chained, tamper-evident record of sign-ins, role
  and group changes, secret deliveries, deployments, guardrail decisions and
  retention sweeps in **Settings → Governance → Audit log**. The audit log is
  locked and never deletable. Audit log export is included on **Enterprise** and
  licensed self-hosted installs.
- **OpenTelemetry export:** Owners and Admins can forward operational run logs
  and traces to any public HTTPS OTLP/HTTP collector in **Settings → Developers
  → OpenTelemetry export**.
- **Outbound network rules:** Owners and Admins restrict which external
  hostnames agents and sandboxes may reach in **Settings → Governance →
  Guardrails → Network**.

## How support request data is handled

- **Org-scoped access:** support requests belong to your organization. Members
  see only their own requests; Owners and Admins see every request from the
  organization.
- **Audit-logged support access:** when Preprocess Support inspects your
  organization context to help with a request, access is read-only for that
  specific request and every access is recorded in your organization's audit
  log.
- **Support retention:** closed support requests are retained for **2 years**
  and attachments for **1 year**. Deleting an organization deletes its support
  requests.

## Related docs

- [Security and data handling](https://docs.preprocess.com/deploy-and-operate/security-and-data-handling)
- [Logs and audit trail](https://docs.preprocess.com/concepts/logs-and-audit)
