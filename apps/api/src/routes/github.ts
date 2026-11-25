// The GitHub App's routes (docs/design/08-github-app.md): the webhook and the
// installation callback GitHub calls, and the organization's view of its
// installations, repository links and builds.

import { audit } from "@preprocess/db/audit";
import {
  orgId,
  withOrg,
  withoutOrg,
  type OrgId,
  type Tx,
} from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import {
  githubBuilds,
  githubInstallations,
  githubLinks,
  githubRepositories,
} from "@preprocess/db/schema/github";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { queueName, type BuildRef } from "../builds.ts";
import {
  actor,
  eventBase,
  requireAdmin,
  type OrgVariables,
} from "../caller.ts";
import { AGENT_SLUG } from "../deploy.ts";
import type { Env } from "../env.ts";
import {
  getInstallation,
  installUrl,
  listRepositories,
  personCanReach,
  readState,
  verifyWebhook,
  type Repository,
} from "../github.ts";

const saveRepositories = async (
  tx: Tx,
  org: string,
  installationId: string,
  repositories: Repository[],
) => {
  for (const r of repositories)
    await tx
      .insert(githubRepositories)
      .values({
        id: newId("githubRepository"),
        organizationId: org,
        installationId,
        repositoryId: r.id,
        fullName: r.full_name,
        defaultBranch: r.default_branch ?? null,
        private: r.private,
      })
      .onConflictDoUpdate({
        target: [
          githubRepositories.installationId,
          githubRepositories.repositoryId,
        ],
        set: {
          fullName: r.full_name,
          defaultBranch: r.default_branch ?? null,
          private: r.private,
          removedAt: null,
        },
      });
};

// The organization that installed the App, found across organizations from
// GitHub's installation id.
const installationOwner = async (env: Env, installationId: number) => {
  const [row] = await withoutOrg(env, "github webhook", (tx) =>
    tx
      .select({
        id: githubInstallations.id,
        organizationId: githubInstallations.organizationId,
      })
      .from(githubInstallations)
      .where(eq(githubInstallations.installationId, installationId)),
  );
  return row ? { id: row.id, org: orgId(row.organizationId) } : null;
};

type InstallationPayload = {
  action: string;
  installation: { id: number };
  repositories_added?: Repository[];
  repositories_removed?: { id: number }[];
};

type PushPayload = {
  ref: string;
  after: string;
  deleted?: boolean;
  repository: { id: number };
  installation?: { id: number };
};

const onInstallation = async (
  env: Env,
  event: string,
  p: InstallationPayload,
) => {
  const owner = await installationOwner(env, p.installation.id);
  if (!owner) return { ignored: "installation is not linked" };
  return withOrg(env, owner.org, async (tx) => {
    const where = eq(githubInstallations.id, owner.id);
    if (event === "installation" && p.action === "deleted") {
      await tx.delete(githubInstallations).where(where);
    } else if (event === "installation" && p.action === "suspend") {
      await tx
        .update(githubInstallations)
        .set({ suspendedAt: new Date() })
        .where(where);
    } else if (event === "installation" && p.action === "unsuspend") {
      await tx
        .update(githubInstallations)
        .set({ suspendedAt: null })
        .where(where);
    } else if (event === "installation_repositories") {
      await saveRepositories(
        tx,
        owner.org,
        owner.id,
        p.repositories_added ?? [],
      );
      const removed = (p.repositories_removed ?? []).map((r) => r.id);
      if (removed.length)
        await tx
          .update(githubRepositories)
          .set({ removedAt: new Date() })
          .where(
            and(
              eq(githubRepositories.installationId, owner.id),
              inArray(githubRepositories.repositoryId, removed),
            ),
          );
    } else return { ignored: p.action };
    await audit(tx, {
      organizationId: owner.org,
      actorType: "platform",
      actorId: "github",
      action:
        event === "installation"
          ? `github.installation.${p.action}`
          : "github.repositories.changed",
      targetType: "github_installation",
      targetId: owner.id,
      data: { installation: p.installation.id },
    });
    return { ok: true };
  });
};

const onPush = async (env: Env, p: PushPayload) => {
  if (!p.ref.startsWith("refs/heads/") || p.deleted || !p.installation)
    return { builds: [] };
  const branch = p.ref.slice("refs/heads/".length);
  const owner = await installationOwner(env, p.installation.id);
  if (!owner) return { builds: [] };
  const queued = await withOrg(env, owner.org, async (tx) => {
    const links = await tx
      .select({ link: githubLinks })
      .from(githubLinks)
      .innerJoin(
        githubRepositories,
        eq(githubRepositories.id, githubLinks.repositoryId),
      )
      .where(
        and(
          eq(githubRepositories.installationId, owner.id),
          eq(githubRepositories.repositoryId, p.repository.id),
          isNull(githubRepositories.removedAt),
          or(isNull(githubLinks.branch), eq(githubLinks.branch, branch)),
        ),
      );
    const builds: { id: string; agent: string }[] = [];
    for (const { link } of links) {
      const id = newId("githubBuild");
      await tx.insert(githubBuilds).values({
        id,
        organizationId: owner.org,
        linkId: link.id,
        agentSlug: link.agentSlug,
        branch,
        commit: p.after,
        status: "queued",
      });
      builds.push({ id, agent: link.agentSlug });
    }
    return builds;
  });
  for (const build of queued)
    await env.BUILDS.getByName(queueName(owner.org, build.agent, branch)).push({
      organizationId: owner.org,
      buildId: build.id,
    } satisfies BuildRef);
  return { builds: queued.map((b) => b.id) };
};

// GitHub calls these two without a Preprocess session.
export const githubCallbacks = new OpenAPIHono<{ Bindings: Env }>();

githubCallbacks.post("/github/webhook", async (c) => {
  const body = await c.req.text();
  if (!(await verifyWebhook(c.env, body, c.req.header("x-hub-signature-256"))))
    return c.json({ error: "the signature does not match" }, 401);
  const event = c.req.header("x-github-event") ?? "";
  const payload = JSON.parse(body) as unknown;
  if (event === "push")
    return c.json(await onPush(c.env, payload as PushPayload), 202);
  if (event === "installation" || event === "installation_repositories")
    return c.json(
      await onInstallation(c.env, event, payload as InstallationPayload),
    );
  return c.json({ ignored: event });
});

// Where GitHub sends the installing person. The signed state names the
// organization and person who asked; their OAuth code proves they can reach
// the installation, so nobody links someone else's installation by its id.
githubCallbacks.get("/github/setup", async (c) => {
  const state = await readState(c.env, c.req.query("state") ?? "");
  const installationId = Number(c.req.query("installation_id"));
  const code = c.req.query("code");
  if (!state || !Number.isSafeInteger(installationId) || !code)
    throw new HTTPException(400, {
      message: "this installation link has expired",
    });
  if (!(await personCanReach(c.env, code, installationId)))
    throw new HTTPException(403, {
      message: "your GitHub account cannot reach this installation",
    });
  const owner = await installationOwner(c.env, installationId);
  if (owner && owner.org !== state.org)
    throw new HTTPException(409, {
      message: "this installation belongs to another organization",
    });
  const installation = await getInstallation(c.env, installationId);
  const repositories = await listRepositories(c.env, installationId);
  const org = orgId(state.org);
  await withOrg(c.env, org, async (tx) => {
    const [row] = await tx
      .insert(githubInstallations)
      .values({
        id: owner?.id ?? newId("githubInstallation"),
        organizationId: org,
        installationId,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        createdBy: state.user,
      })
      .onConflictDoUpdate({
        target: githubInstallations.installationId,
        set: {
          accountLogin: installation.account.login,
          accountType: installation.account.type,
        },
      })
      .returning();
    await saveRepositories(tx, org, row!.id, repositories);
    await audit(tx, {
      organizationId: org,
      actorType: "person",
      actorId: state.user,
      action: "github.installed",
      targetType: "github_installation",
      targetId: row!.id,
      data: {
        account: installation.account.login,
        repositories: repositories.length,
      },
    });
  });
  return c.redirect(new URL("/settings/github", c.env.APP_URL).href);
});

export const githubRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>();

const Repository = z
  .object({
    fullName: z.string(),
    private: z.boolean(),
    defaultBranch: z.string().nullable(),
    account: z.string(),
    suspended: z.boolean(),
    link: z
      .object({
        agent: z.string(),
        branch: z.string().nullable(),
        directory: z.string(),
        entry: z.string(),
      })
      .nullable(),
  })
  .openapi("GitHubRepository");

const Link = z
  .object({
    repository: z.string().openapi({ description: "owner/name" }),
    branch: z.string().min(1).nullable().default(null).openapi({
      description: "Build pushes to this branch only; null builds every branch",
    }),
    directory: z
      .string()
      .default("")
      .refine((d) => !d.startsWith("/") && !d.split("/").includes(".."), {
        message: "directory is a path inside the repository",
      }),
    entry: z
      .string()
      .default("src/index.ts")
      .refine((d) => !d.startsWith("/") && !d.split("/").includes(".."), {
        message: "entry is a path inside the directory",
      }),
  })
  .openapi("GitHubLink");

const Build = z
  .object({
    id: z.string(),
    agent: z.string(),
    status: z.enum([
      "queued",
      "running",
      "succeeded",
      "failed",
      "timed_out",
      "superseded",
    ]),
    branch: z.string(),
    commit: z.string(),
    deploymentId: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
  })
  .openapi("Build");

const buildView = (b: typeof githubBuilds.$inferSelect) => ({
  id: b.id,
  agent: b.agentSlug,
  status: b.status,
  branch: b.branch,
  commit: b.commit,
  deploymentId: b.deploymentId,
  error: b.error,
  createdAt: b.createdAt.toISOString(),
  startedAt: b.startedAt?.toISOString() ?? null,
  finishedAt: b.finishedAt?.toISOString() ?? null,
});

const OrgParams = z.object({ org: z.string() });
const AgentParams = OrgParams.extend({ agent: z.string() });

const repositories = (env: Env, org: OrgId) =>
  withOrg(env, org, (tx) =>
    tx
      .select({
        repository: githubRepositories,
        installation: githubInstallations,
        link: githubLinks,
      })
      .from(githubRepositories)
      .innerJoin(
        githubInstallations,
        eq(githubInstallations.id, githubRepositories.installationId),
      )
      .leftJoin(
        githubLinks,
        eq(githubLinks.repositoryId, githubRepositories.id),
      )
      .where(isNull(githubRepositories.removedAt))
      .orderBy(githubRepositories.fullName),
  );

githubRoutes.openapi(
  createRoute({
    method: "post",
    path: "/github/install",
    tags: ["GitHub"],
    summary:
      "A link that installs the GitHub App for this organization (Admin or Owner)",
    request: { params: OrgParams },
    responses: {
      200: {
        description: "Open it in a browser; GitHub returns to the app",
        content: {
          "application/json": { schema: z.object({ url: z.string() }) },
        },
      },
    },
  }),
  async (c) => {
    requireAdmin(c.var.caller);
    return c.json(
      {
        url: await installUrl(c.env, {
          org: c.var.org,
          user: actor(c.var.caller).actorId,
        }),
      },
      200,
    );
  },
);

githubRoutes.openapi(
  createRoute({
    method: "get",
    path: "/github/repositories",
    tags: ["GitHub"],
    summary:
      "Repositories the organization's installations grant, with their links",
    request: { params: OrgParams },
    responses: {
      200: {
        description: "By name",
        content: { "application/json": { schema: z.array(Repository) } },
      },
    },
  }),
  async (c) => {
    const rows = await repositories(c.env, c.var.org);
    return c.json(
      rows.map((r) => ({
        fullName: r.repository.fullName,
        private: r.repository.private,
        defaultBranch: r.repository.defaultBranch,
        account: r.installation.accountLogin,
        suspended: r.installation.suspendedAt !== null,
        link: r.link
          ? {
              agent: r.link.agentSlug,
              branch: r.link.branch,
              directory: r.link.directory,
              entry: r.link.entry,
            }
          : null,
      })),
      200,
    );
  },
);

githubRoutes.openapi(
  createRoute({
    method: "put",
    path: "/agents/{agent}/github",
    tags: ["GitHub"],
    summary:
      "Build this agent from a repository on every push (Admin or Owner); the first build creates the agent",
    request: {
      params: AgentParams,
      body: {
        content: { "application/json": { schema: Link } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The link",
        content: {
          "application/json": { schema: Link.extend({ agent: z.string() }) },
        },
      },
    },
  }),
  async (c) => {
    requireAdmin(c.var.caller);
    const { agent } = c.req.valid("param");
    if (!AGENT_SLUG.test(agent))
      throw new HTTPException(400, {
        message: `agent name must match ${AGENT_SLUG}`,
      });
    const input = c.req.valid("json");
    const link = await withOrg(c.env, c.var.org, async (tx) => {
      const [repository] = await tx
        .select()
        .from(githubRepositories)
        .where(
          and(
            eq(githubRepositories.fullName, input.repository),
            isNull(githubRepositories.removedAt),
          ),
        );
      if (!repository)
        throw new HTTPException(404, {
          message: "no installation of the GitHub App grants this repository",
        });
      const values = {
        repositoryId: repository.id,
        branch: input.branch,
        directory: input.directory.replace(/\/+$/, ""),
        entry: input.entry,
      };
      const [row] = await tx
        .insert(githubLinks)
        .values({
          id: newId("githubLink"),
          organizationId: c.var.org,
          agentSlug: agent,
          createdBy: actor(c.var.caller).actorId,
          ...values,
        })
        .onConflictDoUpdate({
          target: [githubLinks.organizationId, githubLinks.agentSlug],
          set: values,
        })
        .returning();
      await audit(tx, {
        ...eventBase(c.var),
        action: "github.linked",
        targetType: "github_link",
        targetId: row!.id,
        data: { agent, repository: input.repository, branch: input.branch },
      });
      return row!;
    });
    return c.json(
      {
        agent,
        repository: input.repository,
        branch: link.branch,
        directory: link.directory,
        entry: link.entry,
      },
      200,
    );
  },
);

githubRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/agents/{agent}/github",
    tags: ["GitHub"],
    summary: "Stop building this agent from GitHub (Admin or Owner)",
    request: { params: AgentParams },
    responses: { 204: { description: "Unlinked" } },
  }),
  async (c) => {
    requireAdmin(c.var.caller);
    const { agent } = c.req.valid("param");
    await withOrg(c.env, c.var.org, async (tx) => {
      const [row] = await tx
        .delete(githubLinks)
        .where(eq(githubLinks.agentSlug, agent))
        .returning();
      if (!row)
        throw new HTTPException(404, {
          message: "this agent has no GitHub link",
        });
      await audit(tx, {
        ...eventBase(c.var),
        action: "github.unlinked",
        targetType: "github_link",
        targetId: row.id,
        data: { agent },
      });
    });
    return c.body(null, 204);
  },
);

githubRoutes.openapi(
  createRoute({
    method: "get",
    path: "/agents/{agent}/builds",
    tags: ["GitHub"],
    summary: "The agent's GitHub builds, newest first",
    request: { params: AgentParams },
    responses: {
      200: {
        description: "The latest 50",
        content: { "application/json": { schema: z.array(Build) } },
      },
    },
  }),
  async (c) => {
    const rows = await withOrg(c.env, c.var.org, (tx) =>
      tx
        .select()
        .from(githubBuilds)
        .where(eq(githubBuilds.agentSlug, c.req.valid("param").agent))
        .orderBy(desc(githubBuilds.createdAt))
        .limit(50),
    );
    return c.json(rows.map(buildView), 200);
  },
);

githubRoutes.openapi(
  createRoute({
    method: "get",
    path: "/agents/{agent}/builds/{build}",
    tags: ["GitHub"],
    summary: "One build, with the tail of its sandbox log",
    request: { params: AgentParams.extend({ build: z.string() }) },
    responses: {
      200: {
        description: "The build",
        content: {
          "application/json": {
            schema: Build.extend({ log: z.string().nullable() }),
          },
        },
      },
    },
  }),
  async (c) => {
    const { agent, build } = c.req.valid("param");
    const [row] = await withOrg(c.env, c.var.org, (tx) =>
      tx
        .select()
        .from(githubBuilds)
        .where(
          and(eq(githubBuilds.id, build), eq(githubBuilds.agentSlug, agent)),
        ),
    );
    if (!row) throw new HTTPException(404, { message: "build not found" });
    return c.json({ ...buildView(row), log: row.log }, 200);
  },
);
