#!/usr/bin/env node
// The `preprocess` command. It signs in with PREPROCESS_API_KEY, else with
// the session `preprocess login` saved; a key never comes from a flag, so it
// never lands in shell history or CI logs.

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { casesCreate } from "./cases.ts";
import {
  readCredentials,
  resolveTarget,
  writeCredentials,
} from "./credentials.ts";
import { bundle, deploy, describe, entryPath, gitInfo } from "./deploy.ts";
import { evalsList, evalsRun } from "./evals.ts";
import { githubApp } from "./github-app.ts";
import { init } from "./init.ts";
import { install } from "./install.ts";
import { login } from "./login.ts";
import { logs } from "./logs.ts";
import { promote, rollback } from "./promote.ts";
import { configPull, groupsPull } from "./pull.ts";
import { usage } from "./usage.ts";

export const main = async (argv: string[], env = process.env) => {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agent: { type: "string" },
      case: { type: "string" },
      text: { type: "string" },
      file: { type: "string", multiple: true },
      "idempotency-key": { type: "string" },
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
      "no-browser": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command] = positionals;
  const pull =
    (command === "config" || command === "groups") && positionals[1] === "pull";
  const cases = command === "cases" && positionals[1] === "create";
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
      command !== "login" &&
      command !== "init" &&
      !(command === "promote" && positionals[1]) &&
      command !== "rollback" &&
      !pull &&
      !cases &&
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
  if (command === "login") {
    const api =
      values.api ?? env.PREPROCESS_API_URL ?? readCredentials(env)?.api;
    if (!api)
      return {
        code: 1,
        out: `Missing --api or PREPROCESS_API_URL.\n\n${usage}`,
      };
    return login({
      api,
      org: values.org ?? env.PREPROCESS_ORG,
      browser: !values["no-browser"],
      log: (line) => console.error(line),
      save: (credentials) => writeCredentials(env, credentials),
    });
  }
  if (command === "init")
    return init({ dir: positionals[1] ?? ".", name: values.name });
  if (command === "promote" || command === "rollback") {
    const { org, api, key } = resolveTarget(values, env);
    const agent = values.agent ?? packageName(process.cwd());
    if (!org || !api || !key || !agent)
      return {
        code: 1,
        out: `Missing --agent, --org, --api or a sign-in (preprocess login or PREPROCESS_API_KEY).\n\n${usage}`,
      };
    const target = { api, org, key, agent };
    return command === "promote"
      ? promote({ ...target, deployment: positionals[1]! })
      : rollback({ ...target, deployment: positionals[1] });
  }
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
  if (cases) {
    const { org, api, key } = resolveTarget(values, env);
    const agent = values.agent ?? packageName(process.cwd());
    if (!org || !api || !key || !agent)
      return {
        code: 1,
        out: `Missing --agent, --org, --api or a sign-in (preprocess login or PREPROCESS_API_KEY).\n\n${usage}`,
      };
    if (!values.text && !values.file?.length)
      return { code: 1, out: `Give --text, --file or both.\n\n${usage}` };
    return {
      code: 0,
      ...(await casesCreate({
        api,
        org,
        key,
        agent,
        text: values.text,
        files: values.file,
        deployment: values.deployment,
        idempotencyKey: values["idempotency-key"],
      })),
    };
  }
  if (evals) {
    const { org, api, key } = resolveTarget(values, env);
    const agent = values.agent ?? packageName(process.cwd());
    if (!org || !api || !key)
      return {
        code: 1,
        out: `Missing --org, --api or a sign-in (preprocess login or PREPROCESS_API_KEY).\n\n${usage}`,
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
    const { org, api, key } = resolveTarget(values, env);
    if (!org || !api || !key)
      return {
        code: 1,
        out: `Missing --org, --api or a sign-in (preprocess login or PREPROCESS_API_KEY).\n\n${usage}`,
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
  const { org, api, key } = resolveTarget(values, env);
  const missing = [
    !agent && command !== "groups" && "--agent",
    !org && "--org or PREPROCESS_ORG",
    !api && "--api or PREPROCESS_API_URL",
    !key && "a sign-in (preprocess login or PREPROCESS_API_KEY)",
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
    entry: entryPath(entry, cwd),
    onBuilding: () =>
      console.error(
        `${agent}: building the sandbox's custom environment; this can take a few minutes`,
      ),
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
