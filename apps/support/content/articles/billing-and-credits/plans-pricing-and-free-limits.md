---
title: Plans, pricing and Free plan limits
description:
  Compare Free, Team and Enterprise plans and understand how seats, cases,
  storage and credits are billed.
updated: 2026-11-28
---

Preprocess Cloud offers three plans: **Free**, **Team** and **Enterprise**.
Organization **Owners** can view and change the plan in **Settings →
Organization → Billing**.

## Plan comparison

| Feature                                           | Free                                | Team                                   | Enterprise                      |
| ------------------------------------------------- | ----------------------------------- | -------------------------------------- | ------------------------------- |
| **Active seats**                                  | Up to 3 developer or operator seats | $16 per active seat per month          | Custom / invoice                |
| **Viewers**                                       | Free                                | Free                                   | Free                            |
| **Monthly cases**                                 | Up to 1,000 included (from launch)  | First 1,000 free, then tiered per case | Custom                          |
| **Storage included**                              | 5 GB ($0.10/GB-month overage)       | 50 GB ($0.10/GB-month overage)         | Custom                          |
| **Starting credit**                               | One-time $5 credit                  | Prepaid credits (carries over)         | Paid by invoice                 |
| **Custom sandbox environments (`sandbox.setup`)** | No                                  | Yes                                    | Yes                             |
| **SAML/OIDC SSO & SCIM**                          | No                                  | No                                     | Yes                             |
| **Audit log export**                              | No                                  | No                                     | Yes                             |
| **Support**                                       | Form, email (best effort)           | + API, Slack Connect (8h Sev 1)        | + Named contact (1h 24/7 Sev 1) |

## How billing works

Preprocess separates recurring charges from metered usage:

- **Prepaid credits (usage):** model usage, `decide`, OCR, sandbox time and (on
  Team) per-case fees past 1,000 cases draw from your credit balance. Amounts
  are in US dollars (internally, 1 credit equals $0.01). Credits never expire.
- **Billed at month end (card):** active developer and operator seats (on Team)
  and storage over your plan's allowance bill to your payment method at the end
  of the UTC month. Storage never draws from credits.

### Team per-case fees

On Team, your first **1,000 cases** each UTC month have no case fee. Additional
cases draw from your credit balance at:

- **1,001–10,000 cases:** $0.02 per case
- **10,001–100,000 cases:** $0.01 per case
- **100,001+ cases:** $0.005 per case

### Free plan limits and card requirement

From launch, every Preprocess Cloud organization needs a payment method on file
before agents can run, including on the Free plan. On Free:

- **Seats:** capped at 3 active developer or operator seats. Viewers are
  unlimited and free.
- **Cases:** capped at 1,000 cases per UTC month from launch.
- **Storage:** 5 GB is included. Storage above 5 GB isn't a hard cap—overage
  bills at $0.10/GB-month to your card at month end.
- **Credits:** your balance starts with a one-time $5 credit. You can top up or
  enable auto-reload anytime.

## Upgrade your plan

1. Open **Settings → Organization → Billing**.
2. Select **Change plan**.
3. Choose **Upgrade** on Team (or **Contact us** for Enterprise).
4. Enter your first top-up amount ($10 minimum; your existing balance carries
   over) and confirm.

## Related articles

- [Buy credits and set up auto-reload](/billing-and-credits/buy-credits-and-set-auto-reload)
- [Cancel your Team plan or delete an organization](/billing-and-credits/cancel-plan-or-delete-organization)
