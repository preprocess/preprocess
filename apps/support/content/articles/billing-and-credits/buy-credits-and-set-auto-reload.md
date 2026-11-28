---
title: Buy credits and set up auto-reload
description:
  Add prepaid credits to your balance and configure automatic top-ups so cases
  never stall.
updated: 2026-11-28
---

Usage charges—model turns, `decide`, OCR, sandbox time and Team per-case fees
over 1,000 cases—draw from your organization's prepaid credit balance. Credits
never expire, and both Free and Team organizations can buy credits and use
auto-reload.

Only organization **Owners** can access **Settings → Organization → Billing**.

## Buy credits manually

1. Open **Settings → Organization → Billing**.
2. Under **Credits**, select **Top up**.
3. Choose a preset amount ($50, $100, $250 or $500) or select **Other amount**
   and enter a whole-dollar amount between **$10 and $5,000**.
4. Choose your saved card or select **Use another card** to enter a different
   card at checkout.
5. Select **Add** (or **Pay** when using another card) to complete the purchase.

If your balance went negative from an in-flight overage, the negative amount is
deducted automatically from your next top-up.

## Set up auto-reload

Auto-reload tops up your balance automatically whenever it drops below a
threshold you set. You need a card on file to turn it on.

1. Open **Settings → Organization → Billing**.
2. In the **Credits** section, turn on **Auto-reload**.
3. Configure three whole-dollar values:
   - **When balance falls below:** minimum **$5**.
   - **Add:** between **$10 and $5,000**, and greater than your threshold.
   - **Monthly cap:** must be at least your reload amount. By default, this
     matches your monthly spending limit if one is set.
4. Select **Save**.

## If an auto-reload fails or hits its cap

- **Card declined:** Billing displays the failure next to Auto-reload, and
  Owners and Admins see an **Auto-reload failed** notice in the sidebar. Select
  **Update card** to fix your payment method, or **Retry** to charge the saved
  card again.
- **Monthly cap reached:** auto-reload pauses for the rest of the UTC month and
  resumes automatically on the 1st of the next month (UTC). You can raise the
  monthly cap or run a manual **Top up** at any time.

## What happens when your balance runs out

If your credit balance reaches $0.00 (or negative), new cases return `402`
(`credit_exhausted`) and running cases transition to `halted` before the next
metered call. Once you top up your balance, open any halted case and select
**Rerun** to continue—halted cases don't resume automatically.

Need a refund on unused credits?
[Contact support](/getting-started/contact-support-and-response-times)—refunds
are handled case by case.
