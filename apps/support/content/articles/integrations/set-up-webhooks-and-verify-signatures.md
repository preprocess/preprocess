---
title: Set up webhooks and verify signatures
description:
  Register HTTPS webhook endpoints for case events, verify Standard Webhooks
  signatures and handle retries.
updated: 2026-11-28
---

Outbound webhooks send signed HTTPS `POST` notifications to your systems
whenever a case completes, fails or waits on a team.

## Register a webhook endpoint

Owners, Admins and organization API keys can manage webhooks in **Settings →
Developers → API keys & webhooks** (or via `POST /v1/orgs/{org}/webhooks`).

1. Open **Settings → Developers → API keys & webhooks**.
2. Add an endpoint with a public `https://` URL (`localhost` and private IP
   addresses are refused).
3. Select the event types to subscribe to, and optionally restrict the endpoint
   to specific agents.
4. Copy the signing secret (`whsec_...`) immediately—it is shown once.

## Event types

| Event              | When it fires                    | Key payload fields                                                     |
| ------------------ | -------------------------------- | ---------------------------------------------------------------------- |
| `case.completed`   | Case reaches `completed`         | `case`, `answers` (inlined under 256 KB, else `null`) and `answersUrl` |
| `case.failed`      | Case reaches `failed`            | `case` and `error` (`code` and `message`)                              |
| `case.needs_group` | Case enters `waiting` on a group | `case`, `group`, `reason` and optional `approval`                      |

Halted and cancelled cases don't emit webhooks.

## Verify webhook signatures

Preprocess signs every delivery following the **Standard Webhooks**
specification using three headers:

- `webhook-id` — delivery ID (`msg_...`), stable across retries
- `webhook-timestamp` — Unix timestamp in seconds
- `webhook-signature` — `v1,<base64>` HMAC-SHA256 of
  `${id}.${timestamp}.${rawBody}`

Verify against the raw request body using constant-time comparison and reject
timestamps outside your replay window (for example 5 minutes):

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyWebhook(
  rawBody: string,
  headers: { id: string; timestamp: string; signature: string },
  secret: string,
): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest("base64");
  const expectedBuf = Buffer.from(`v1,${expected}`);

  return headers.signature.split(" ").some((sig) => {
    const candidate = Buffer.from(sig);
    return (
      candidate.length === expectedBuf.length &&
      timingSafeEqual(candidate, expectedBuf)
    );
  });
}
```

When you rotate a signing secret, Preprocess dual-signs deliveries with both the
new and previous secret (space-separated in `webhook-signature`) for **24
hours** so you can roll keys without downtime.

## Retries and automatic disabling

Each delivery uses a **10-second** timeout, follows no redirects and requires an
HTTP `2xx` response. Failed deliveries retry after **30 seconds**, **2
minutes**, **10 minutes**, **30 minutes**, **1 hour** and then every **3 hours**
for up to **24 hours**.

If an endpoint fails continuously for **3 days**, Preprocess disables it
automatically and emails your organization's Owners and Admins.

## Related docs

- [Schedules and webhooks](https://docs.preprocess.com/concepts/schedules-and-webhooks)
