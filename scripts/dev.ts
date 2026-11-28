// `pnpm dev`: installs dependencies, prepares local Postgres, then starts the
// apps behind portless at https://app.preprocess.localhost,
// https://api.preprocess.localhost, https://docs.preprocess.localhost and
// https://support.preprocess.localhost. Workers, the Durable Object, the queue and
// R2 run in Cloudflare's local runtime (workerd, through wrangler and the Vite
// plugin); nothing reaches Cloudflare.

import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const run = (args: string[]) => {
  const result = spawnSync("pnpm", args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(
      `\n\`pnpm ${args.join(" ")}\` failed. Is Postgres running at DATABASE_URL (default postgresql://preprocess:preprocess@127.0.0.1:5432/preprocess_development)?`,
    );
    process.exit(result.status ?? 1);
  }
};

run(["install", "--frozen-lockfile"]);

// The API's local secrets: a Better Auth secret and the audit signing key,
// generated once per checkout and never committed.
const apiVars = path.join(import.meta.dirname, "../apps/api/.dev.vars");
if (!existsSync(apiVars)) {
  const auditKey = generateKeyPairSync("ed25519")
    .privateKey.export({ format: "der", type: "pkcs8" })
    .toString("base64");
  writeFileSync(
    apiVars,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64")}\nAUDIT_SIGNING_KEY=${auditKey}\n`,
  );
}
// The GitHub App's local credentials, for scripts/github-stub.ts: an App
// private key (PKCS #8, base64), a webhook secret and a client secret. Added
// to checkouts whose .dev.vars predates them.
const present = readFileSync(apiVars, "utf8");
const github = {
  GITHUB_APP_PRIVATE_KEY: () =>
    generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ format: "der", type: "pkcs8" })
      .toString("base64"),
  GITHUB_WEBHOOK_SECRET: () => randomBytes(32).toString("hex"),
  GITHUB_CLIENT_SECRET: () => randomBytes(20).toString("hex"),
};
for (const [name, value] of Object.entries(github))
  if (!new RegExp(`^${name}=`, "m").test(present))
    appendFileSync(apiVars, `${name}=${value()}\n`);
run(["--filter", "@preprocess/infra", "wrangler:generate"]);

// In a git worktree portless prefixes each hostname with the branch
// (fix-ui.app.preprocess.localhost), so the URLs the Workers use come from
// portless and override wrangler.jsonc's defaults through each app's
// .dev.vars. Better Auth trusts APP_URL as the sign-in origin.
const origin = (name: string) => {
  const result = spawnSync(
    "pnpm",
    ["exec", "portless", "get", name, "--json"],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  return `https://${(JSON.parse(result.stdout) as { hostname: string }).hostname}`;
};
const appUrl = origin("app.preprocess");
const modelStubUrl = origin("model-stub.preprocess");
const setDevVars = (app: string, values: Record<string, string>) => {
  const file = path.join(import.meta.dirname, `../apps/${app}/.dev.vars`);
  const kept = existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter(
          (line) =>
            line &&
            !Object.keys(values).some((name) => line.startsWith(`${name}=`)),
        )
    : [];
  writeFileSync(
    file,
    [
      ...kept,
      ...Object.entries(values).map(([name, value]) => `${name}=${value}`),
    ].join("\n") + "\n",
  );
};
setDevVars("api", { APP_URL: appUrl, MODEL_SERVICE_URL: modelStubUrl });
setDevVars("runtime", { MODEL_SERVICE_URL: modelStubUrl });
setDevVars("docs", { API_URL: `${appUrl}/v1` });
setDevVars("support", {
  APP_URL: appUrl,
  DOCS_URL: origin("docs.preprocess"),
});
// The docs site's API reference reads the API's OpenAPI document.
run(["--filter", "@preprocess/docs", "openapi"]);
run(["db:migrate"]);
run(["db:seed"]);

const apps = spawn("pnpm", ["exec", "portless"], { stdio: "inherit" });
// GitHub builds run the build image under the local Docker.
const builder = spawn(
  "node",
  [path.join(import.meta.dirname, "../apps/builder/local/server.ts")],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    apps.kill(signal);
    builder.kill(signal);
  });
}
apps.on("exit", (code) => process.exit(code ?? 0));
