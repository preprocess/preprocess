// `preprocess promote` and `preprocess rollback`: serve a deployment from
// the agent's production branch in production. Rolling back promotes the
// deployment that served production before the current one; only code rolls
// back, never the runtime (spec 4).

import type { Deployment } from "./deploy.ts";
import { describe } from "./deploy.ts";

export type PromoteOptions = {
  api: string;
  org: string;
  key: string;
  agent: string;
  fetch?: typeof fetch;
};

type Listed = Deployment & {
  promotedAt: string | null;
  git: { branch: string | null; commit: string | null };
};

const client = (options: PromoteOptions) => {
  const base = options.api.endsWith("/") ? options.api : options.api + "/";
  const prefix = `v1/orgs/${encodeURIComponent(options.org)}/agents/${encodeURIComponent(options.agent)}/deployments`;
  return async <T>(method: "GET" | "POST", route: string) => {
    const response = await (options.fetch ?? fetch)(
      new URL(prefix + route, base),
      { method, headers: { authorization: `Bearer ${options.key}` } },
    );
    const body = (await response.json()) as T & {
      error?: { message?: string } | string;
    };
    if (!response.ok) {
      const message =
        typeof body.error === "string" ? body.error : body.error?.message;
      throw new Error(
        `${method} deployments${route} failed (${response.status}): ${message ?? "unknown error"}`,
      );
    }
    return body;
  };
};

const promoteOne = async (options: PromoteOptions, deployment: string) => {
  const promoted = await client(options)<Deployment>(
    "POST",
    `/${encodeURIComponent(deployment)}/promote`,
  );
  return describe(options.agent, promoted);
};

export const promote = async (
  options: PromoteOptions & { deployment: string },
) => ({ code: 0, out: await promoteOne(options, options.deployment) });

export const rollback = async (
  options: PromoteOptions & { deployment?: string | undefined },
) => {
  if (options.deployment)
    return { code: 0, out: await promoteOne(options, options.deployment) };
  const served = (
    await client(options)<Listed[]>("GET", "?environment=production")
  )
    .filter((d) => d.promotedAt)
    .sort((a, b) => b.promotedAt!.localeCompare(a.promotedAt!));
  const [current, previous] = served;
  if (!current || !previous)
    return {
      code: 1,
      out: `${options.agent} has no earlier production deployment to roll back to.`,
    };
  const commit = previous.git.commit?.slice(0, 7);
  return {
    code: 0,
    out: [
      `Rolling ${options.agent} back from ${current.id} to ${previous.id}${commit ? ` (${commit})` : ""}.`,
      await promoteOne(options, previous.id),
    ].join("\n"),
  };
};
