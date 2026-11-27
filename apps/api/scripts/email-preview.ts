// Every system email rendered with sample data (demo org, no customer data).
//
// Serve them as HTML and plain text, with the images from apps/app/public:
//
//   pnpm --filter @preprocess/api email:preview [port]
//
// Or send each one to a test inbox for real-client checks, through the
// Email Sending REST API of the account staging sends from. Images and
// links point at <app-url>, which must serve /brand/email/ (staging or a
// pull request's preview). Never send to a customer's or Chip's address.
//
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… EMAIL_FROM=… \
//     pnpm --filter @preprocess/api email:preview send <to> <app-url>

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import {
  assignedEmail,
  invitationEmail,
  magicLinkEmail,
  taggedEmail,
  waitingEmail,
  webhookDisabledEmail,
} from "../src/email-templates.ts";
import type { Brand, RenderedEmail } from "../src/email-templates.ts";

const assets = path.join(import.meta.dirname, "../../app/public/brand/email");

const cloud = (appUrl: string): Brand => ({ appUrl, selfHosted: false });
const selfHosted = (appUrl: string): Brand => ({ appUrl, selfHosted: true });

const caseData = (app: string) => ({
  url: new URL("/cases/agt_7Hq2/case_K91x", app).href,
  settingsUrl: new URL("/settings/account", app).href,
  orgName: "Northwind",
  agent: "refunds",
  caseTitle: "Refund over limit for order 48213",
});
const message =
  "The customer asks for a $1,240 refund on order 48213. That is over the $1,000 I can approve. Can someone in Billing approve or decline it?";
const webhook = (app: string) => ({
  url: new URL("/settings/organization/api-keys", app).href,
  endpointUrl: "https://hooks.northwind.example/preprocess",
  orgName: "Northwind",
  days: 3,
});

const samples: Record<string, (app: string) => RenderedEmail> = {
  "magic-link": (app) =>
    magicLinkEmail(cloud(app), {
      url: new URL(
        "/api/auth/magic-link/verify?token=Zr4uQ8m1NcY2vD7kTb0sXe5hLp3a&callbackURL=%2Finbox",
        app,
      ).href,
    }),
  invitation: (app) =>
    invitationEmail(cloud(app), {
      url: new URL("/invitations/inv_3Fk8sP0q", app).href,
      email: "jo@northwind.example",
      orgName: "Northwind",
      inviterName: "Maya Chen",
    }),
  tagged: (app) =>
    taggedEmail(cloud(app), {
      ...caseData(app),
      tagger: "The refunds agent",
      groupName: "Billing",
      message,
    }),
  "tagged-by-person": (app) =>
    taggedEmail(cloud(app), {
      ...caseData(app),
      tagger: "Maya Chen",
      groupName: "Billing",
      message,
    }),
  assigned: (app) => assignedEmail(cloud(app), caseData(app)),
  "assigned-self-hosted": (app) =>
    assignedEmail(selfHosted(app), caseData(app)),
  waiting: (app) =>
    waitingEmail(cloud(app), {
      ...caseData(app),
      groupName: "Billing",
      reason: "Refunds over $1,000 need approval from Billing.",
    }),
  "waiting-no-reason": (app) =>
    waitingEmail(cloud(app), {
      ...caseData(app),
      groupName: "Billing",
      reason: null,
    }),
  "webhook-disabled": (app) => webhookDisabledEmail(cloud(app), webhook(app)),
};

const send = async (to: string | undefined, app: string | undefined) => {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, EMAIL_FROM } =
    process.env;
  if (!to?.includes("@") || !app)
    throw new Error("usage: email:preview send <to> <app-url>");
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !EMAIL_FROM)
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and EMAIL_FROM must be set",
    );
  const named = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(EMAIL_FROM);
  const from = named
    ? { name: named[1], address: named[2] }
    : { address: EMAIL_FROM.trim() };
  for (const [name, render] of Object.entries(samples)) {
    const email = render(new URL(app).origin);
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/email/sending/send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ to, from, ...email }),
      },
    );
    const body = (await response.json()) as {
      success: boolean;
      errors: { code: number; message: string }[];
    };
    if (!body.success)
      throw new Error(
        `${name}: ${response.status} ${body.errors.map((e) => `${e.code} ${e.message}`).join(", ")}`,
      );
    console.log(`sent ${name}`);
  }
};

const serve = (port: number) =>
  createServer((request, response) => {
    void (async () => {
      const origin = `http://${request.headers.host ?? `localhost:${port}`}`;
      const { pathname } = new URL(request.url ?? "/", origin);
      if (pathname.startsWith("/brand/email/")) {
        try {
          const png = await readFile(
            path.join(assets, path.basename(pathname)),
          );
          response.writeHead(200, { "content-type": "image/png" });
          return response.end(png);
        } catch {
          response.writeHead(404);
          return response.end();
        }
      }
      const match = /^\/([a-z-]+)\.(html|txt)$/.exec(pathname);
      const render = match ? samples[match[1]!] : undefined;
      if (match && render) {
        const email = render(origin);
        if (match[2] === "html") {
          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
          });
          return response.end(email.html);
        }
        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        return response.end(`Subject: ${email.subject}\n\n${email.text}`);
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!DOCTYPE html><title>System emails</title><ul>${Object.keys(samples)
          .map(
            (name) =>
              `<li>${name}: <a href="/${name}.html">HTML</a> · <a href="/${name}.txt">text</a></li>`,
          )
          .join("")}</ul>`,
      );
    })();
  }).listen(port, () => {
    console.log(`System email previews on http://localhost:${port}`);
  });

if (process.argv[2] === "send") await send(process.argv[3], process.argv[4]);
else serve(Number(process.argv[2] ?? 8796));
