---
title: Set monthly spending limits and alerts
description:
  Cap monthly metered usage in Guardrails and understand low-balance and billing
  notices.
updated: 2026-11-28
---

A monthly spending limit puts a hard ceiling on your organization's metered
usage each calendar month (UTC) so runaway loops or unexpected traffic can't
exhaust your budget.

## Set or change a monthly spending limit

Owners and Admins can set, update or remove the monthly spending limit.

1. Open **Settings → Governance → Guardrails** and go to **Spending limit**
   (Owners can also select **Manage in Guardrails** from **Settings →
   Organization → Billing**).
2. Enter a monthly limit in US dollars and save.
3. To remove the cap later, select **Remove limit**.

There is no spending limit by default.

## What the limit counts

- **Included:** all metered usage across every deployment—production, previews
  and eval runs—covering model usage, `decide`, OCR, sandbox time and per-case
  fees.
- **Excluded:** active seat charges and storage overages billed at month end.
- **Reset:** the counter resets on the **1st of each month (UTC)**.
- **Auto-reload interaction:** your spending limit is also used as the default
  monthly cap when you enable auto-reload.

## What happens when you reach the limit

When usage reaches the limit:

- New cases, reruns and OCR calls are refused with HTTP `402`
  (`spending_limit_reached`) for the rest of the UTC month.
- Running cases transition to `halted` before their next metered call,
  preserving every answer and thread message produced so far.
- Halted cases send no webhooks and don't auto-resume.

To resume work, raise or remove the limit in **Settings → Governance →
Guardrails → Spending limit** (or wait for the 1st of the month UTC), then open
each halted case and select **Rerun**.

## Billing notices and low-balance alerts

Preprocess surfaces billing warnings in the **sidebar notice stack** (at the
bottom of the left sidebar, or under the bell icon when collapsed):

- **Low credit balance:** shown to Owners and Admins when your balance drops
  below your auto-reload threshold (or below **$5** if auto-reload is off).
- **Credit balance is empty:** shown to Owners and Admins with a link to
  Billing; Members see a read-only **Cases are paused** notice.
- **Auto-reload failed / cap reached / Payment failed / Team ends:** shown to
  Owners and Admins with a direct link to **Settings → Organization → Billing**.

Errors and warnings stay visible until resolved and can't be dismissed.
