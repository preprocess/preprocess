---
title: Cancel your Team plan or delete an organization
description:
  Downgrade from Team to Free without losing data or permanently delete an
  organization.
updated: 2026-11-28
---

You can downgrade a Team organization to Free at any time without losing data,
or permanently delete an organization if you no longer need it. Both actions are
**Owner-only**.

## Cancel your Team plan (downgrade to Free)

Cancelling Team is **never blocked** and **nothing is deleted**. Your
organization stays on Team until the end of the current billing period, then
moves to Free.

1. Open **Settings → Organization → Billing**.
2. Select **Cancel plan** (or open **Change plan** and select **Switch to
   Free**).
3. Review **What changes** on your end date. Preprocess lists only the items
   that apply to your current usage:
   - **Active seats (if you have more than 3):** Free includes 3 active
     developer or operator seats. Select **Change** to pick the 3 people who
     keep active seats—everyone else becomes a free viewer. If you don't pick,
     Owners keep access first, then the most recently active members.
   - **Custom sandbox environments:** agents using `sandbox.setup` are named and
     will pause for new cases on the end date. Remove the custom setup in code
     to keep them running on Free, or re-upgrade later to resume them
     automatically. All other agents keep running.
   - **Storage over 5 GB:** your data stays intact, and usage above 5 GB bills
     at **$0.10/GB-month** to your card at month end. Use **Manage retention**
     if you want to lower stored data.
   - **Monthly cases:** from launch, Free is capped at **1,000 cases per
     month**.
4. Select **Continue**, optionally choose a reason and select **Cancel plan**.

### What carries over when Team ends

- **In-flight cases** finish normally.
- **Your credit balance and auto-reload settings** carry over to Free.
- **Your final invoice** at the end of the billing period covers that month's
  active seats and any storage overage; no seat charges follow after that.

Affected team members receive an email 3 days before their access changes, and
Owners receive a summary email when the switch completes.

### Undo cancellation or re-upgrade later

- **Before the end date:** select **Keep Team** in **Settings → Organization →
  Billing** to cancel the scheduled downgrade.
- **After moving to Free:** if you upgrade back to Team later, paused
  custom-environment agents resume automatically and Owners see a one-click
  **Restore previous roles** prompt to restore everyone who moved to viewer.

Enterprise plans don't have self-serve cancellation—select **Contact us** in
**Change plan** or
[contact support](/getting-started/contact-support-and-response-times).

## Delete an organization

Deleting an organization is **immediate and permanent**.

1. Open **Settings → Organization → General**.
2. Scroll to **Delete organization** and select **Delete**.
3. Confirm the deletion.

### What happens when you delete an organization

- All agents, deployments, cases, files, secrets, logs and support requests for
  that organization are permanently removed and can't be recovered.
- **Any remaining credit balance is forfeited.**
- If you were on Team, your subscription cancels immediately and active seats
  used in the current month are reported for your final invoice.
