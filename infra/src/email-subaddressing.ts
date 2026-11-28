// Turns on Email Routing subaddressing for a zone, so mail to
// r+<token>@<support inbound domain> matches the literal r@ rule
// (apps/api/src/support.ts threads replies by the token). Cloudflare.Email.
// Routing would set it too, but it also enables Email Routing on the apex,
// which adds MX records there; preprocess.com's mail is Google Workspace's.
// This sets only the one zone setting, and leaves it on when removed.

import * as emailRouting from "@distilled.cloud/cloudflare/email-routing";
import { Action } from "alchemy";
import * as Effect from "effect/Effect";

export const EmailSubaddressing = Action(
  "Preprocess.EmailSubaddressing",
  (input: { zoneId: string }) =>
    emailRouting.edit({ zoneId: input.zoneId, supportSubaddress: true }).pipe(
      Effect.map((result) => ({
        zoneId: input.zoneId,
        subaddressing: result.supportSubaddress ?? null,
      })),
    ),
);
