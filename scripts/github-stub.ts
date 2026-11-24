// A stand-in for GitHub in `pnpm dev` (docs/design/08-github-app.md): the
// App's REST endpoints the API calls, tarballs from local git checkouts, the
// install redirect, and signed webhooks. Run it beside `pnpm dev`:
//
//   node scripts/github-stub.ts --repo acme/agents=../my-agent
//   curl -X POST 'http://127.0.0.1:8791/__push?repo=acme/agents&branch=main'
//
// It issues fake installation tokens and checks each tarball request carries
// a live token scoped to that repository. It never prints a token.

import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    repo: { type: "string", multiple: true, default: [] },
    installation: { type: "string", default: "4242" },
    account: { type: "string", default: "acme" },
    api: { type: "string", default: "https://api.preprocess.localhost" },
    port: { type: "string", default: "8791" },
  },
});
// The local API sits behind portless's own certificate authority.
if (new URL(values.api).hostname.endsWith(".localhost"))
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const devVars = Object.fromEntries(
  readFileSync(path.join(root, "apps/api/.dev.vars"), "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1),
    ]),
);
const installationId = Number(values.installation);
const repos = values.repo.map((spec, i) => {
  const [fullName, dir] = spec.split("=");
  if (!fullName || !dir) throw new Error("--repo owner/name=path/to/checkout");
  return { id: 1000 + i, fullName, dir: path.resolve(dir) };
});
const tokens = new Map<
  string,
  { repositoryIds?: number[]; revoked: boolean }
>();
const log = (message: string) => console.log(`github-stub: ${message}`);

const json = (response: ServerResponse, status: number, body: unknown) =>
  response
    .writeHead(status, { "content-type": "application/json" })
    .end(JSON.stringify(body));

const repoView = (r: (typeof repos)[number]) => ({
  id: r.id,
  full_name: r.fullName,
  default_branch: "main",
  private: true,
});

const readBody = async (request: AsyncIterable<Buffer>) => {
  let text = "";
  for await (const chunk of request) text += chunk.toString();
  return text;
};

const sendWebhook = async (event: string, payload: unknown) => {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", devVars.GITHUB_WEBHOOK_SECRET ?? "")
    .update(body)
    .digest("hex");
  const response = await fetch(new URL("/v1/github/webhook", values.api), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": `sha256=${signature}`,
    },
    body,
  });
  return { status: response.status, body: await response.text() };
};

createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://github.stub");
    const auth = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const route = `${request.method} ${url.pathname}`;
    log(route);

    let match = /^POST \/app\/installations\/(\d+)\/access_tokens$/.exec(route);
    if (match) {
      if (Number(match[1]) !== installationId || auth.split(".").length !== 3)
        return json(response, 401, { message: "Bad credentials" });
      const scope = JSON.parse(await readBody(request)) as {
        repository_ids?: number[];
      };
      const token = `ghs_${randomBytes(18).toString("hex")}`;
      tokens.set(token, {
        ...(scope.repository_ids && { repositoryIds: scope.repository_ids }),
        revoked: false,
      });
      log(
        `issued a token for ${scope.repository_ids ? `repositories ${scope.repository_ids.join(",")}` : "the installation"}`,
      );
      return json(response, 201, {
        token,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
    }
    if (route === "DELETE /installation/token") {
      const held = tokens.get(auth);
      if (held) held.revoked = true;
      log("revoked a token");
      return response.writeHead(204).end();
    }
    match = /^GET \/app\/installations\/(\d+)$/.exec(route);
    if (match)
      return json(response, 200, {
        id: installationId,
        account: { login: values.account, type: "Organization" },
      });
    if (route === "GET /installation/repositories")
      return json(response, 200, {
        total_count: repos.length,
        repositories: repos.map(repoView),
      });
    match = /^GET \/repos\/([^/]+\/[^/]+)\/tarball\/([0-9a-f]+)$/.exec(route);
    if (match) {
      const repo = repos.find((r) => r.fullName === match![1]);
      const held = tokens.get(auth);
      if (
        !repo ||
        !held ||
        held.revoked ||
        (held.repositoryIds && !held.repositoryIds.includes(repo.id))
      )
        return json(response, 404, { message: "Not Found" });
      const name = repo.fullName.replace("/", "-");
      response.writeHead(200, { "content-type": "application/x-gzip" });
      spawn(
        "git",
        [
          "archive",
          "--format=tar.gz",
          `--prefix=${name}-${match[2].slice(0, 7)}/`,
          match[2],
        ],
        { cwd: repo.dir, stdio: ["ignore", "pipe", "inherit"] },
      ).stdout.pipe(response);
      return;
    }
    // The install link: GitHub would ask the person, then send them to the
    // App's setup URL with the installation, the state and an OAuth code.
    match = /^GET \/apps\/[^/]+\/installations\/new$/.exec(route);
    if (match) {
      const setup = new URL("/v1/github/setup", values.api);
      setup.searchParams.set("installation_id", String(installationId));
      setup.searchParams.set("setup_action", "install");
      setup.searchParams.set("state", url.searchParams.get("state") ?? "");
      setup.searchParams.set("code", "development");
      return response.writeHead(302, { location: setup.href }).end();
    }
    if (route === "POST /login/oauth/access_token")
      return json(response, 200, {
        access_token: `gho_${randomBytes(18).toString("hex")}`,
      });
    if (route === "GET /user/installations")
      return json(response, 200, { installations: [{ id: installationId }] });

    // The fake webhook: a signed push of the checkout's current commit.
    if (route === "POST /__push") {
      const repo = repos.find(
        (r) => r.fullName === url.searchParams.get("repo"),
      );
      const branch = url.searchParams.get("branch") ?? "main";
      if (!repo) return json(response, 404, { message: "unknown repo" });
      const after = execFileSync("git", ["rev-parse", branch], {
        cwd: repo.dir,
        encoding: "utf8",
      }).trim();
      const sent = await sendWebhook("push", {
        ref: `refs/heads/${branch}`,
        after,
        repository: repoView(repo),
        installation: { id: installationId },
      });
      return json(response, 200, { commit: after, api: sent });
    }
    if (route === "GET /__tokens")
      return json(response, 200, [...tokens.values()]);
    return json(response, 404, { message: "Not Found" });
  })().catch((error: unknown) => {
    console.error(error);
    if (!response.headersSent) json(response, 500, { message: String(error) });
  });
}).listen(Number(values.port), "127.0.0.1", () =>
  log(
    `GitHub stand-in on http://127.0.0.1:${values.port} for ${repos.map((r) => r.fullName).join(", ") || "no repositories"}`,
  ),
);
