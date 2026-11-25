// `preprocess install`: installs or upgrades Preprocess in your own Cloudflare
// account (spec 16). It runs the same Alchemy stack our cloud deploys from, as
// a self-hosted stage: every Worker, bucket, queue, Durable Object, container
// and Hyperdrive config, then bootstrap and migrations on your Postgres. The
// source is a release of preprocess/preprocess, downloaded and kept under the
// cache directory, or a checkout passed with --source. Secrets are read from the
// environment or --env-file (later files win over earlier ones and over the
// environment) and passed through, never printed.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseEnv } from "node:util";

export const REPOSITORY = "preprocess/preprocess";

type Env = Record<string, string | undefined>;

export type Run = (
  command: string,
  args: string[],
  options: { cwd: string; env: Env; stdin?: ReadableStream<Uint8Array> },
) => Promise<number>;

// What a self-hosted stage needs (infra/README.md), and what it must not have.
export const checkInstallEnv = (env: Env) => {
  const problems = [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "DATABASE_URL",
    "EMAIL_FROM",
    "MODEL_SERVICE_URL",
  ]
    .filter((name) => !env[name])
    .map((name) => `${name} is not set`);
  if (
    env.MODEL_SERVICE_URL &&
    env.MODEL_SERVICE_URL !== "stub" &&
    !env.MODEL_SERVICE_KEY
  )
    problems.push("MODEL_SERVICE_KEY is not set");
  if (env.PREPROCESS_REGION)
    problems.push(
      "PREPROCESS_REGION is set; it marks a deploy as Preprocess's own cloud, so unset it",
    );
  for (const name of [
    "PLANETSCALE_DATABASE",
    "BETTER_AUTH_SECRET",
    "AUDIT_SIGNING_KEY",
  ])
    if (env[name])
      problems.push(`${name} is set; a self-hosted install does not use it`);
  return problems;
};

export const isInstallStage = (stage: string) =>
  /^selfhost(-[a-z0-9]+(-[a-z0-9]+)*)?$/.test(stage);

const defaultRun: Run = (command, args, { cwd, env, stdin }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: [stdin ? "pipe" : "inherit", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
    if (stdin && child.stdin)
      pipeline(Readable.fromWeb(stdin as never), child.stdin).catch(reject);
  });

const cacheDir = (env: Env) =>
  path.join(
    env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"),
    "preprocess",
    "releases",
  );

// The release to install: the tag asked for, or the latest published release.
const resolveVersion = async (
  version: string | undefined,
  fetcher: typeof fetch,
) => {
  if (version) return version;
  const response = await fetcher(
    `https://api.github.com/repos/${REPOSITORY}/releases/latest`,
    { headers: { accept: "application/vnd.github+json" } },
  );
  if (!response.ok)
    throw new Error(
      `Could not find the latest release of ${REPOSITORY} (GitHub answered ${response.status}). Pass --version <tag>.`,
    );
  return ((await response.json()) as { tag_name: string }).tag_name;
};

const download = async (
  tag: string,
  dir: string,
  fetcher: typeof fetch,
  run: Run,
  env: Env,
) => {
  if (existsSync(path.join(dir, "package.json"))) return;
  const response = await fetcher(
    `https://codeload.github.com/${REPOSITORY}/tar.gz/refs/tags/${encodeURIComponent(tag)}`,
  );
  if (!response.ok || !response.body)
    throw new Error(
      `Could not download ${REPOSITORY} ${tag} (GitHub answered ${response.status}).`,
    );
  mkdirSync(dir, { recursive: true });
  const code = await run("tar", ["-xzf", "-", "--strip-components=1"], {
    cwd: dir,
    env,
    stdin: response.body,
  });
  if (code !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Could not unpack ${REPOSITORY} ${tag}.`);
  }
};

export const install = async (options: {
  stage: string;
  plan: boolean;
  version?: string | undefined;
  source?: string | undefined;
  envFiles: string[];
  env: Env;
  run?: Run;
  fetch?: typeof fetch;
}) => {
  const run = options.run ?? defaultRun;
  const fetcher = options.fetch ?? fetch;
  const env: Env = {
    ...options.env,
    ...(Object.assign(
      {},
      ...options.envFiles.map((file) => parseEnv(readFileSync(file, "utf8"))),
    ) as Env),
  };
  if (!isInstallStage(options.stage))
    return {
      code: 1,
      out: `--stage must be selfhost or selfhost-<name> (lowercase letters, digits and dashes), not "${options.stage}".`,
    };
  const problems = checkInstallEnv(env);
  if (problems.length)
    return {
      code: 1,
      out: `Cannot install:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    };

  let source = options.source && path.resolve(options.source);
  if (!source) {
    const tag = await resolveVersion(options.version, fetcher);
    source = path.join(cacheDir(env), tag);
    await download(tag, source, fetcher, run, env);
  }
  const { packageManager } = JSON.parse(
    readFileSync(path.join(source, "package.json"), "utf8"),
  ) as { packageManager?: string };
  if (!packageManager?.startsWith("pnpm@"))
    return {
      code: 1,
      out: `${source} is not a preprocess/preprocess checkout.`,
    };

  // The stack runs non-interactively; CI only changes how Alchemy reports.
  const pnpm = (args: string[]) =>
    run("npx", ["--yes", packageManager, ...args], { cwd: source, env });
  if ((await pnpm(["install", "--frozen-lockfile"])) !== 0)
    return { code: 1, out: "Installing the stack's dependencies failed." };
  const script = options.plan ? "selfhost:plan" : "selfhost:deploy";
  if (
    (await pnpm(["--filter", "@preprocess/infra", script, options.stage])) !== 0
  )
    return {
      code: 1,
      out: options.plan
        ? "Planning the install failed."
        : "The install failed.",
    };
  return {
    code: 0,
    out: options.plan
      ? `Planned ${options.stage}. Nothing was changed.`
      : `Installed ${options.stage}. The app's URL is in the outputs above.`,
  };
};
