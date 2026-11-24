// `pnpm dev`: installs dependencies, prepares local Postgres, then starts the
// apps behind portless at https://app.preprocess.localhost and
// https://api.preprocess.localhost. Workers, the Durable Object, the queue and
// R2 run in Cloudflare's local runtime (workerd, through wrangler and the Vite
// plugin); nothing reaches Cloudflare.

import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
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
run(["--filter", "@preprocess/infra", "wrangler:generate"]);
run(["db:migrate"]);
run(["db:seed"]);

const apps = spawn("pnpm", ["exec", "portless"], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => apps.kill(signal));
}
apps.on("exit", (code) => process.exit(code ?? 0));
