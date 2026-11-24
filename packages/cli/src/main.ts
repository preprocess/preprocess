#!/usr/bin/env node
// The `preprocess` command. The API key comes only from PREPROCESS_API_KEY,
// so it never lands in shell history or CI logs.

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { bundle, deploy, describe, gitInfo } from "./deploy.ts";
import { logs } from "./logs.ts";
import { configPull, groupsPull } from "./pull.ts";

const usage = `Usage: preprocess deploy [entry] [--agent <name>] [--org <id>] [--api <url>]
       preprocess config pull [entry] [--agent <name>] [--org <id>] [--api <url>]
       preprocess groups pull [entry] [--org <id>] [--api <url>]
       preprocess logs [--agent <id>] [--case <id>] [--deployment <id>]
                       [--level <level>] [--search <text>] [--limit <n>]

  deploy       bundle and deploy the agent
  config pull  write the agent's dashboard overrides into preprocess.config.json
  groups pull  write the organization's groups into preprocess.config.json
  logs         print run logs, newest first: a case's, or the agent's,
               deployment's or organization's (Developers and Admins)

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
      org: { type: "string" },
      api: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command] = positionals;
  const pull =
    (command === "config" || command === "groups") && positionals[1] === "pull";
  if (values.help || (command !== "deploy" && command !== "logs" && !pull))
    return { code: command ? 1 : 0, out: usage };
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
