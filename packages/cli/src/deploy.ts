// `preprocess deploy`: bundle an agent written with @preprocess/sdk into one
// ES module and upload it with its git branch and commit. The API reads the
// manifest from the uploaded code, binds the organization secrets the agent
// is granted, and promotes deploys from the agent's production branch.

import { execFileSync } from "node:child_process";

import { build } from "esbuild";

export type Bundle = { mainModule: string; modules: Record<string, string> };
export type Git = { branch?: string; commit?: string };

export type Deployment = {
  id: string;
  status: "ready" | "waiting" | "failed";
  environment: "production" | "preview";
  production: boolean;
  waitingFor: { secrets?: string[]; mcp?: string[] };
  sdkVersion: string;
  tools: string[];
};

// The same target the platform runs agent code on: a Workers module.
export const bundle = async (entry: string): Promise<Bundle> => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2023",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["module", "main"],
    external: ["cloudflare:*", "node:*"],
    logLevel: "silent",
  });
  const [output] = result.outputFiles;
  if (!output) throw new Error(`esbuild produced nothing for ${entry}`);
  return { mainModule: "agent.js", modules: { "agent.js": output.text } };
};

const git = (cwd: string, ...args: string[]) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
};

// A detached checkout (CI) has no branch name, so CI's own variables fill it.
export const gitInfo = (cwd: string, env = process.env): Git => {
  const local = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
  const branch =
    local && local !== "HEAD"
      ? local
      : env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || undefined;
  const commit = git(cwd, "rev-parse", "HEAD") ?? env.GITHUB_SHA;
  return {
    ...(branch && { branch }),
    ...(commit && { commit }),
  };
};

export type DeployOptions = {
  api: string;
  org: string;
  agent: string;
  key: string;
  bundle: Bundle;
  git: Git;
  fetch?: typeof fetch;
};

export const deploy = async (options: DeployOptions): Promise<Deployment> => {
  const url = new URL(
    `v1/orgs/${encodeURIComponent(options.org)}/agents/${encodeURIComponent(options.agent)}/deployments`,
    options.api.endsWith("/") ? options.api : `${options.api}/`,
  );
  const response = await (options.fetch ?? fetch)(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ bundle: options.bundle, git: options.git }),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // not JSON
    }
    throw new Error(`deploy failed (${response.status}): ${message}`);
  }
  return JSON.parse(text) as Deployment;
};

export const describe = (agent: string, d: Deployment) => {
  if (d.status === "failed") return `${agent}: deployment ${d.id} failed`;
  if (d.status === "waiting") {
    const grants = [
      ...(d.waitingFor.secrets ?? []).map((s) => `secret ${s}`),
      ...(d.waitingFor.mcp ?? []).map((m) => `MCP server ${m}`),
    ];
    return `${agent}: deployment ${d.id} is waiting for grants: ${grants.join(", ")}`;
  }
  return `${agent}: deployment ${d.id} is ready (${d.production ? "serving production" : d.environment})`;
};
