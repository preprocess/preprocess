// `pnpm dev`: installs dependencies, prepares local Postgres, then starts the
// apps behind portless at https://app.preprocess.localhost and
// https://api.preprocess.localhost. Workers, the Durable Object, the queue and
// R2 run in Cloudflare's local runtime (workerd, through wrangler and the Vite
// plugin); nothing reaches Cloudflare.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
run(["--filter", "@preprocess/infra", "wrangler:generate"]);
run(["db:migrate"]);
run(["db:seed"]);

// Without WorkOS credentials the app runs in preview mode: a one-button
// sign-in and the seeded scenarios (apps/app/README.md).
const workos =
  process.env.WORKOS_CLIENT_ID ??
  existsSync(path.join(import.meta.dirname, "../apps/app/.dev.vars"));
if (!workos) process.env.PREPROCESS_PREVIEW ??= "true";

// The model stub (doc 07) listens on the fixed address the runtime's
// MODEL_SERVICE_URL names, outside portless, because Workers reach it by URL.
const modelStub = spawn("pnpm", ["--filter", "@preprocess/model-stub", "dev"], {
  stdio: "inherit",
});
const apps = spawn("pnpm", ["exec", "portless"], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    modelStub.kill(signal);
    apps.kill(signal);
  });
}
apps.on("exit", (code) => {
  modelStub.kill();
  process.exit(code ?? 0);
});
