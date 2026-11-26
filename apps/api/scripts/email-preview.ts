// Serves every system email rendered with sample data (demo org, no customer
// data), as HTML and plain text, with the images from apps/app/public.
//
//   pnpm --filter @preprocess/api email:preview [port]

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

const port = Number(process.argv[2] ?? 8796);
const app = "https://app.preprocess.localhost";
const assets = path.join(import.meta.dirname, "../../app/public/brand/email");

const caseData = {
  url: `${app}/cases/agt_7Hq2/case_K91x`,
  settingsUrl: `${app}/settings/account`,
  orgName: "Northwind",
  agent: "refunds",
  caseTitle: "Refund over limit for order 48213",
};

const samples: Record<string, (brand: Brand) => RenderedEmail> = {
  "magic-link": (brand) =>
    magicLinkEmail(brand, {
      url: `${app}/api/auth/magic-link/verify?token=Zr4uQ8m1NcY2vD7kTb0sXe5hLp3a&callbackURL=%2Finbox`,
    }),
  invitation: (brand) =>
    invitationEmail(brand, {
      url: `${app}/invitations/inv_3Fk8sP0q`,
      email: "jo@northwind.example",
      orgName: "Northwind",
      inviterName: "Maya Chen",
    }),
  tagged: (brand) =>
    taggedEmail(brand, {
      ...caseData,
      tagger: "The refunds agent",
      groupName: "Billing",
      message:
        "The customer asks for a $1,240 refund on order 48213. That is over the $1,000 I can approve. Can someone in Billing approve or decline it?",
    }),
  assigned: (brand) => assignedEmail(brand, caseData),
  waiting: (brand) =>
    waitingEmail(brand, {
      ...caseData,
      groupName: "Billing",
      reason: "Refunds over $1,000 need approval from Billing.",
    }),
  "waiting-no-reason": (brand) =>
    waitingEmail(brand, { ...caseData, groupName: "Billing", reason: null }),
  "webhook-disabled": (brand) =>
    webhookDisabledEmail(brand, {
      url: `${app}/developers/webhooks`,
      endpointUrl: "https://hooks.northwind.example/preprocess",
      orgName: "Northwind",
    }),
};

createServer((request, response) => {
  void (async () => {
    const origin = `http://${request.headers.host ?? `localhost:${port}`}`;
    const { pathname } = new URL(request.url ?? "/", origin);
    if (pathname.startsWith("/brand/email/")) {
      const file = path.basename(pathname);
      try {
        response.writeHead(200, { "content-type": "image/png" });
        return response.end(await readFile(path.join(assets, file)));
      } catch {
        response.writeHead(404);
        return response.end();
      }
    }
    const match = /^\/([a-z-]+)\.(html|txt)$/.exec(pathname);
    const render = match ? samples[match[1]!] : undefined;
    if (match && render) {
      const email = render({ appUrl: origin });
      if (match[2] === "html") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return response.end(email.html);
      }
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
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
