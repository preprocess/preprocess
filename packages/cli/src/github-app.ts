// `preprocess github-app`: registers a self-hosted install's own GitHub App
// through GitHub's manifest flow (docs/design/08-github-app.md), so nobody
// copies settings by hand. It serves one page on 127.0.0.1 that posts the
// manifest to GitHub; GitHub sends the browser back with a code, which is
// exchanged for the App's credentials. They are written to an env file
// readable only by you, ready for `preprocess install --env-file` or your
// CI's secrets, and never printed.

import { createPrivateKey, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

export const manifest = (options: {
  appUrl: string;
  name: string;
  redirectUrl: string;
}) => {
  const app = options.appUrl.replace(/\/+$/, "");
  return {
    name: options.name,
    url: app,
    hook_attributes: { url: `${app}/v1/github/webhook`, active: true },
    redirect_url: options.redirectUrl,
    callback_urls: [`${app}/v1/github/setup`],
    setup_url: `${app}/v1/github/setup`,
    setup_on_update: true,
    request_oauth_on_install: true,
    public: true,
    default_permissions: { contents: "read", metadata: "read" },
    default_events: ["push"],
  };
};

type Conversion = {
  id: number;
  slug: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string;
  pem: string;
};

const quote = (value: string) => `"${value.replaceAll("\n", "\\n")}"`;

// The six values the stack reads (infra/src/stages.ts), with the private key
// converted to PKCS #8, the only form Workers' WebCrypto imports.
export const envFile = (app: Conversion) =>
  [
    `GITHUB_APP_ID=${app.id}`,
    `GITHUB_APP_SLUG=${app.slug}`,
    `GITHUB_CLIENT_ID=${app.client_id}`,
    `GITHUB_CLIENT_SECRET=${quote(app.client_secret)}`,
    `GITHUB_WEBHOOK_SECRET=${quote(app.webhook_secret)}`,
    `GITHUB_APP_PRIVATE_KEY=${quote(
      createPrivateKey(app.pem)
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    )}`,
    "",
  ].join("\n");

export const convert = async (code: string, fetcher: typeof fetch) => {
  const response = await fetcher(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    { method: "POST", headers: { accept: "application/vnd.github+json" } },
  );
  if (!response.ok)
    throw new Error(
      `GitHub did not create the App (it answered ${response.status}).`,
    );
  return (await response.json()) as Conversion;
};

const page = (action: string, body: object) => `<!doctype html>
<meta charset="utf-8">
<title>Register the Preprocess GitHub App</title>
<form method="post" action="${action}">
  <input type="hidden" name="manifest" value="${JSON.stringify(body).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">
  <p>Registering your Preprocess GitHub App on GitHub…</p>
  <button type="submit">Continue to GitHub</button>
</form>
<script>document.forms[0].submit()</script>`;

export const githubApp = (options: {
  appUrl: string;
  name: string;
  owner?: string | undefined;
  out: string;
  port?: number;
  log: (line: string) => void;
  fetch?: typeof fetch;
}) =>
  new Promise<{ code: number; out: string }>((resolve, reject) => {
    const state = randomBytes(16).toString("hex");
    const github = options.owner
      ? `https://github.com/organizations/${encodeURIComponent(options.owner)}/settings/apps/new`
      : "https://github.com/settings/apps/new";
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const redirectUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/callback`;
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          page(
            `${github}?state=${state}`,
            manifest({ ...options, redirectUrl }),
          ),
        );
        return;
      }
      const code = url.searchParams.get("code");
      if (
        url.pathname !== "/callback" ||
        !code ||
        url.searchParams.get("state") !== state
      ) {
        response.writeHead(404).end();
        return;
      }
      convert(code, options.fetch ?? fetch)
        .then((app) => {
          writeFileSync(options.out, envFile(app), { mode: 0o600 });
          response.writeHead(200, {
            "content-type": "text/plain; charset=utf-8",
          });
          response.end(
            `The GitHub App ${app.slug} is registered. You can close this tab.`,
          );
          server.close();
          resolve({
            code: 0,
            out: `Registered https://github.com/apps/${app.slug}. Its six GITHUB_* values are in ${options.out} (readable only by you). Pass it to preprocess install with --env-file, or copy them into your CI's secrets, then delete the file.`,
          });
        })
        .catch((error: unknown) => {
          response.writeHead(502).end("GitHub did not create the App.");
          server.close();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      options.log(
        `Open http://127.0.0.1:${port}/ in a browser signed in to GitHub${options.owner ? ` as an owner of ${options.owner}` : ""}, and create the App there.`,
      );
    });
  });
