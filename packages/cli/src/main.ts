#!/usr/bin/env node
// The `preprocess` command. The API key comes only from PREPROCESS_API_KEY,
// so it never lands in shell history or CI logs.

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { bundle, deploy, describe, gitInfo } from "./deploy.ts";
import { evalsList, evalsRun } from "./evals.ts";
import { githubApp } from "./github-app.ts";
import { install } from "./install.ts";
import { logs } from "./logs.ts";
import { configPull, groupsPull } from "./pull.ts";

const usage = `Usage: preprocess deploy [entry] [--agent <name>] [--org <id>] [--api <url>]
       preprocess config pull [entry] [--agent <name>] [--org <id>] [--api <url>]
       preprocess groups pull [entry] [--org <id>] [--api <url>]
       preprocess logs [--agent <id>] [--case <id>] [--deployment <id>]
                       [--level <level>] [--search <text>] [--limit <n>]
       preprocess evals list [--agent <name>]
       preprocess evals run <suite> [--deployment <id>] [--model <id>]...
       preprocess install [--version <tag> | --source <dir>] [--stage <name>]
                          [--env-file <path>]... [--plan]
       preprocess github-app --app-url <url> [--name <name>] [--owner <org>]
                             [--out <path>]

  deploy       bundle and deploy the agent
  config pull  write the agent's dashboard overrides into preprocess.config.json
  groups pull  write the organization's groups into preprocess.config.json
  logs         print run logs, newest first: a case's, or the agent's,
               deployment's or organization's (Developers and Admins)
  evals list   list the agent's eval suites
  evals run    run a suite against a deployment (production by default),
               one run per --model, and wait for the results
  install      install or upgrade Preprocess in your own Cloudflare account,
               from a release (the latest by default) or a checkout, as the
               self-hosted stage --stage (default: selfhost); --plan only
               prints what would change. Reads CLOUDFLARE_API_TOKEN,
               CLOUDFLARE_ACCOUNT_ID, DATABASE_URL, EMAIL_FROM,
               MODEL_SERVICE_URL and MODEL_SERVICE_KEY from the environment
               or --env-file; see infra/README.md for the optional ones
  github-app   register your install's own GitHub App on GitHub and write its
               credentials to --out (default: .env.github-app)

  entry     the agent's module (default: src/index.ts)
  --agent   the agent's name (default: package.json name, without its scope)
  --org     organization id (default: PREPROCESS_ORG)
  --api     API origin (default: PREPROCESS_API_URL)

PREPROCESS_API_KEY holds the organization API key.`;

export const main = async (argv: string[], env = process.env) => {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agent: { type: "string" },
      case: { type: "string" },
      deployment: { type: "string" },
      level: { type: "string" },
      search: { type: "string" },
      limit: { type: "string" },
      model: { type: "string", multiple: true },
      org: { type: "string" },
      api: { type: "string" },
      version: { type: "string" },
      source: { type: "string" },
      stage: { type: "string" },
      "env-file": { type: "string", multiple: true },
      plan: { type: "boolean" },
      "app-url": { type: "string" },
      name: { type: "string" },
      owner: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command] = positionals;
  const pull =
    (command === "config" || command === "groups") && positionals[1] === "pull";
  const evals =
    command === "evals" &&
    (positionals[1] === "list" ||
      (positionals[1] === "run" && !!positionals[2]));
  if (
    values.help ||
    (command !== "deploy" &&
      command !== "logs" &&
      command !== "install" &&
      command !== "github-app" &&
      !pull &&
      !evals)
  )
    return { code: command ? 1 : 0, out: usage };
  if (command === "install")
    return install({
      stage: values.stage ?? "selfhost",
      plan: values.plan ?? false,
      version: values.version,
      source: values.source,
      envFiles: values["env-file"] ?? [],
      env,
    });
  if (command === "github-app") {
    if (!values["app-url"])
      return { code: 1, out: `Missing --app-url.\n\n${usage}` };
    return githubApp({
      appUrl: values["app-url"],
      name: values.name ?? "Preprocess",
      owner: values.owner,
      out: values.out ?? ".env.github-app",
      log: (line) => console.log(line),
    });
  }
  if (evals) {
    const org = values.org ?? env.PREPROCESS_ORG;
    const api = values.api ?? env.PREPROCESS_API_URL;
    const key = env.PREPROCESS_API_KEY;
    const agent = values.agent ?? packageName(process.cwd());
    if (!org || !api || !key)
      return {
        code: 1,
        out: `Missing --org, --api or PREPROCESS_API_KEY.\n\n${usage}`,
      };
    if (positionals[1] === "run")
      return evalsRun({
        api,
        org,
        key,
        suite: positionals[2]!,
        deployment: values.deployment,
        models: values.model,
      });
    if (!agent) return { code: 1, out: `Missing --agent.\n\n${usage}` };
    return { code: 0, ...(await evalsList({ api, org, key, agent })) };
  }
  if (command === "logs") {
    const org = values.org ?? env.PREPROCESS_ORG;
    const api = values.api ?? env.PREPROCESS_API_URL;
    const key = env.PREPROCESS_API_KEY;
    if (!org || !api || !key)
      return {
        code: 1,
        out: `Missing --org, --api or PREPROCESS_API_KEY.\n\n${usage}`,
      };
    return {
      code: 0,
      ...(await logs({
        api,
        org,
        key,
        agent: values.agent,
        case: values.case,
        deployment: values.deployment,
        level: values.level,
        search: values.search,
        limit: values.limit ? Number(values.limit) : undefined,
      })),
    };
  }
  const entry = positionals[pull ? 2 : 1] ?? "src/index.ts";

  const cwd = process.cwd();
  const agent = values.agent ?? packageName(cwd);
  const org = values.org ?? env.PREPROCESS_ORG;
  const api = values.api ?? env.PREPROCESS_API_URL;
  const key = env.PREPROCESS_API_KEY;
  const missing = [
    !agent && command !== "groups" && "--agent",
    !org && "--org or PREPROCESS_ORG",
    !api && "--api or PREPROCESS_API_URL",
    !key && "PREPROCESS_API_KEY",
  ].filter(Boolean);
  if (!org || !api || !key || missing.length)
    return { code: 1, out: `Missing ${missing.join(", ")}.\n\n${usage}` };
  const target = { api, org, key, entry: path.resolve(cwd, entry) };
  if (command === "groups") return { code: 0, ...(await groupsPull(target)) };
  if (!agent) return { code: 1, out: usage };
  if (command === "config")
    return { code: 0, ...(await configPull({ ...target, agent })) };

  const deployment = await deploy({
    api,
    org,
    agent,
    key,
    bundle: await bundle(path.resolve(cwd, entry)),
    git: gitInfo(cwd, env),
  });
  return {
    code: deployment.status === "failed" ? 1 : 0,
    out: describe(agent, deployment),
  };
};

const packageName = (cwd: string) => {
  try {
    const { name } = JSON.parse(
      readFileSync(path.join(cwd, "package.json"), "utf8"),
    ) as { name?: string };
    return name?.replace(/^@[^/]+\//, "");
  } catch {
    return undefined;
  }
};

if (import.meta.main) {
  try {
    const { code, out } = await main(process.argv.slice(2));
    (code ? console.error : console.log)(out);
    process.exitCode = code;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
