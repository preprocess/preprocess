// Push builds (docs/design/08-github-app.md). A push to a linked repository
// queues one build per link; a BuildQueue per organization, agent and branch
// runs them one at a time, and a newer push replaces a queued build and
// stops a running one. A build mints a token for the one repository,
// fetches the commit's tarball with it, revokes it, and hands only the
// tarball to the sandbox builder. Its bundle deploys through deploy(), the
// path `preprocess deploy` takes.

import { DurableObject } from "cloudflare:workers";
import { orgId, withOrg } from "@preprocess/db/client";
import {
  githubBuilds,
  githubInstallations,
  githubLinks,
  githubRepositories,
} from "@preprocess/db/schema/github";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { deploy } from "./deploy.ts";
import type { BuildResult, Env } from "./env.ts";
import { commitArchive, withRepositoryToken } from "./github.ts";

export type BuildRef = { organizationId: string; buildId: string };

const LOG_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 600;

export const queueName = (
  organizationId: string,
  agent: string,
  branch: string,
) => `${organizationId}:${agent}:${branch}`;

const finish = (
  env: Env,
  ref: BuildRef,
  fields: Partial<typeof githubBuilds.$inferInsert>,
) =>
  withOrg(env, orgId(ref.organizationId), (tx) =>
    tx
      .update(githubBuilds)
      .set({ ...fields, finishedAt: new Date() })
      .where(eq(githubBuilds.id, ref.buildId)),
  );

type Outcome =
  BuildResult | { status: "superseded" | "timed_out"; log: string };

const runBuild = async (env: Env, ref: BuildRef, signal: AbortSignal) => {
  const job = await withOrg(env, orgId(ref.organizationId), async (tx) => {
    const [row] = await tx
      .select({
        build: githubBuilds,
        link: githubLinks,
        repository: githubRepositories,
        installation: githubInstallations,
      })
      .from(githubBuilds)
      .innerJoin(githubLinks, eq(githubLinks.id, githubBuilds.linkId))
      .innerJoin(
        githubRepositories,
        eq(githubRepositories.id, githubLinks.repositoryId),
      )
      .innerJoin(
        githubInstallations,
        eq(githubInstallations.id, githubRepositories.installationId),
      )
      .where(eq(githubBuilds.id, ref.buildId));
    if (row?.build.status !== "queued") return null;
    await tx
      .update(githubBuilds)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(githubBuilds.id, ref.buildId));
    return row;
  });
  if (!job) return;
  const builder = env.BUILDER;
  const timeoutSeconds = Number(
    env.GITHUB_BUILD_TIMEOUT_SECONDS ?? DEFAULT_TIMEOUT_SECONDS,
  );

  let outcome: Outcome;
  try {
    if (!builder) throw new Error("no build sandbox is configured");
    if (job.installation.suspendedAt)
      throw new Error("the GitHub App installation is suspended");
    outcome = await withRepositoryToken(
      env,
      job.installation.installationId,
      job.repository.repositoryId,
      async (token) => {
        const archive = await commitArchive(
          env,
          token,
          job.repository.fullName,
          job.build.commit,
        );
        // The sandbox's own limit is timeoutSeconds; this one catches a
        // sandbox that never answers.
        const result = await new Promise<Outcome>((resolve, reject) => {
          const timer = setTimeout(
            () => resolve({ status: "timed_out", log: "" }),
            (timeoutSeconds + 30) * 1000,
          );
          signal.addEventListener("abort", () =>
            resolve({ status: "superseded", log: "" }),
          );
          builder
            .build({
              id: ref.buildId,
              archive,
              directory: job.link.directory,
              entry: job.link.entry,
              timeoutSeconds,
            })
            .then(resolve, reject)
            .finally(() => clearTimeout(timer));
        });
        if (signal.aborted || result.status !== "succeeded")
          await builder.cancel(ref.buildId).catch(() => undefined);
        // Defence in depth: the sandbox never saw the token.
        return { ...result, log: result.log.replaceAll(token, "[redacted]") };
      },
    );
  } catch (error) {
    await finish(env, ref, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const log = outcome.log.slice(-LOG_LIMIT);
  if (signal.aborted) outcome = { status: "superseded", log };
  if (outcome.status !== "succeeded") {
    await finish(env, ref, {
      status: outcome.status,
      log,
      error:
        outcome.status === "timed_out"
          ? `the build ran longer than ${timeoutSeconds} seconds`
          : outcome.status === "superseded"
            ? "a newer push replaced this build"
            : "the build failed; see its log",
    });
    return;
  }
  try {
    const deployment = await deploy(
      env,
      orgId(ref.organizationId),
      job.link.agentSlug,
      {
        bundle: outcome.bundle,
        git: { branch: job.build.branch, commit: job.build.commit },
        source: "github",
      },
      { actorType: "platform", actorId: `github:${ref.buildId}` },
    );
    await finish(env, ref, {
      status: "succeeded",
      deploymentId: deployment.id,
      log,
    });
  } catch (error) {
    await finish(env, ref, {
      status: "failed",
      log,
      error:
        error instanceof HTTPException || error instanceof Error
          ? error.message
          : String(error),
    });
  }
};

// One per organization, agent and branch (queueName).
export class BuildQueue extends DurableObject<Env> {
  private running: AbortController | undefined;

  async push(build: BuildRef) {
    const replaced = await this.ctx.storage.get<BuildRef>("next");
    await this.ctx.storage.put("next", build);
    if (replaced)
      await finish(this.env, replaced, {
        status: "superseded",
        error: "a newer push replaced this build",
      });
    this.running?.abort();
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now());
  }

  override async alarm() {
    for (;;) {
      const next = await this.ctx.storage.get<BuildRef>("next");
      if (!next) return;
      await this.ctx.storage.delete("next");
      this.running = new AbortController();
      try {
        await runBuild(this.env, next, this.running.signal);
      } finally {
        this.running = undefined;
      }
    }
  }
}
