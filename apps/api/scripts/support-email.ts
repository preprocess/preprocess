// Feeds a raw message (.eml) to the API's email() handler under `pnpm dev`,
// as Email Routing would on SUPPORT_INBOUND_DOMAIN. Development only: it
// posts to wrangler dev's local email endpoint, which deployed Workers don't
// serve.
//
//   node scripts/support-email.ts <message.eml> [to] [api-url]
//
// `to` defaults to requests@support.preprocess.localhost; a reply threads when
// it is the request's r+<token>@ address. `api-url` defaults to wrangler
// dev's http://localhost:8787.

import { readFile } from "node:fs/promises";

const [
  file,
  to = "requests@support.preprocess.localhost",
  api = "http://localhost:8787",
] = process.argv.slice(2);
if (!file) {
  console.error(
    "usage: node scripts/support-email.ts <message.eml> [to] [api-url]",
  );
  process.exit(1);
}
const raw = await readFile(file, "utf8");
const from =
  /^From:.*?<([^>]+)>/im.exec(raw)?.[1] ??
  /^From:\s*(\S+@\S+)/im.exec(raw)?.[1] ??
  "someone@example.test";
const url = new URL("/cdn-cgi/handler/email", api);
url.searchParams.set("from", from);
url.searchParams.set("to", to);
const response = await fetch(url, { method: "POST", body: raw });
console.log(response.status, await response.text());
