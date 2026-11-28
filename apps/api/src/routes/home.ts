// The home page (PRE-178): for the signed-in person, which of the
// organization's roles they hold, the cards they have to act on, and small
// previews of the pages they use. Everything is computed on read from state
// other routes own; only first-time card dismissals are stored here. Items
// waiting on the person come from the inbox, and billing from /billing.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import {
  invitation,
  member,
  ssoProvider,
  user,
} from "@preprocess/db/schema/auth";
import { seatActivity } from "@preprocess/db/schema/billing";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { evalRuns } from "@preprocess/db/schema/evals";
import { githubLinks } from "@preprocess/db/schema/github";
import { homeDismissals } from "@preprocess/db/schema/home";
import { mcpConnections, mcpServers } from "@preprocess/db/schema/mcp";
import { runMode } from "@preprocess/runmode";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { visibleAgents } from "../access.ts";
import type { Caller, OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";
import { getPlan } from "../plan.ts";
import type { Plan } from "../plan.ts";
import { countSeats } from "../seats.ts";

const OrgParam = z.object({ org: z.string() });

// add-payment-method is decided in the app from /billing, so it is only
// listed here to be dismissed.
export const SETUP_CARDS = [
  "deploy-first-agent",
  "invite-team",
  "create-group",
  "add-payment-method",
  "set-up-sso",
  "install-cli",
  "deploy-template",
  "run-test-case",
  "connect-mcp",
  "link-repository",
  "open-first-case",
] as const;
type SetupCard = (typeof SETUP_CARDS)[number];

export const BROKEN_CARDS = [
  "fix-failed-deploy",
  "reconnect-mcp",
  "add-missing-secret",
  "review-failed-cases",
  "review-eval-regression",
  "fix-directory-sync",
  "renew-license",
  "review-invitations",
] as const;
type BrokenCard = (typeof BROKEN_CARDS)[number];

const AgentRef = z.object({ id: z.string(), slug: z.string() });

const Card = z
  .object({
    id: z.string().openapi({
      description: "The card, then the object it is about, if any",
    }),
    card: z.enum([...SETUP_CARDS, ...BROKEN_CARDS]),
    kind: z.enum(["setup", "broken"]).openapi({
      description: "Setup cards are first-time cards and can be dismissed",
    }),
    agent: AgentRef.nullable(),
    name: z.string().nullable().openapi({
      description: "The MCP server or secret the card names",
    }),
    count: z.number().int().nullable(),
    at: z.string().datetime().nullable().openapi({
      description: "When the license expires or expired",
    }),
  })
  .openapi("HomeCard");

const DeploymentStatus = z.enum(["ready", "waiting", "failed", "building"]);

const Home = z
  .object({
    roles: z.object({
      owner: z.boolean(),
      admin: z.boolean(),
      developer: z
        .boolean()
        .openapi({ description: "In the Developers group" }),
      operator: z.boolean().openapi({
        description: "In a group with operator access to an agent",
      }),
      viewer: z.boolean().openapi({
        description: "In a group with viewer access to an agent",
      }),
    }),
    cards: z.array(Card).openapi({
      description: "Broken first, then first-time setup",
    }),
    dismissed: z.array(z.enum(SETUP_CARDS)).openapi({
      description: "First-time cards the person dismissed here",
    }),
    agents: z
      .object({
        total: z.number().int(),
        items: z.array(
          z.object({
            slug: z.string(),
            status: DeploymentStatus.openapi({
              description: "The newest deployment's status",
            }),
            live: z.boolean().openapi({
              description: "A production deployment serves cases",
            }),
          }),
        ),
      })
      .nullable()
      .openapi({ description: "Developers, Owners and Admins" }),
    cases: z
      .object({
        items: z.array(
          z.object({
            id: z.string(),
            agent: AgentRef,
            title: z.string().nullable(),
            status: z.string(),
            updatedAt: z.string().datetime(),
          }),
        ),
      })
      .nullable()
      .openapi({
        description:
          "The newest production cases, for anyone who can see an agent's cases",
      }),
    activity: z
      .object({
        since: z.string().datetime(),
        hours: z.array(
          z.object({
            started: z.number().int(),
            done: z.number().int(),
            failed: z.number().int(),
          }),
        ),
      })
      .nullable()
      .openapi({
        description:
          "Cases started, completed and failed in each of the last 24 hours; Developers, Owners and Admins",
      }),
    members: z
      .object({
        count: z.number().int(),
        groups: z.number().int(),
        seats: z.object({
          used: z.number().int(),
          limit: z.number().int().nullable(),
        }),
        people: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            image: z.string().nullable(),
          }),
        ),
      })
      .nullable()
      .openapi({ description: "Owners and Admins" }),
  })
  .openapi("Home");

type HomeCard = z.infer<typeof Card>;

const card = (
  name: SetupCard | BrokenCard,
  fields: Partial<Pick<HomeCard, "agent" | "name" | "count" | "at">> = {},
  key?: string,
): HomeCard => ({
  id: key ? `${name}:${key}` : name,
  card: name,
  kind: (SETUP_CARDS as readonly string[]).includes(name) ? "setup" : "broken",
  agent: null,
  name: null,
  count: null,
  at: null,
  ...fields,
});

const person = (caller: Caller) => {
  if (caller.type !== "person")
    throw new HTTPException(403, {
      message: "Home belongs to a person, not an API key.",
    });
  return caller.userId;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Each live agent's newest deployment, and whether one serves production.
const latestDeployments = (tx: Tx) =>
  tx
    .selectDistinctOn([deployments.agentId], {
      agentId: deployments.agentId,
      slug: agents.slug,
      status: deployments.status,
      waitingFor: deployments.waitingFor,
      createdAt: deployments.createdAt,
      live: sql<boolean>`exists (select 1 from deployments served where served.agent_id = ${deployments.agentId} and served.promoted_at is not null)`,
    })
    .from(deployments)
    .innerJoin(agents, eq(agents.id, deployments.agentId))
    .where(isNull(agents.archivedAt))
    .orderBy(deployments.agentId, desc(deployments.createdAt));

// Agents whose suite's newest completed run failed more cases than the run
// before it.
const regressedAgents = async (tx: Tx) => {
  const ranked = tx
    .select({
      suiteId: evalRuns.suiteId,
      deploymentId: evalRuns.deploymentId,
      failed: evalRuns.failed,
      rank: sql<number>`row_number() over (partition by ${evalRuns.suiteId} order by ${evalRuns.createdAt} desc)`.as(
        "rank",
      ),
    })
    .from(evalRuns)
    .where(eq(evalRuns.status, "completed"))
    .as("ranked");
  const rows = await tx
    .select({
      suiteId: ranked.suiteId,
      deploymentId: ranked.deploymentId,
      failed: ranked.failed,
      rank: ranked.rank,
    })
    .from(ranked)
    .where(sql`${ranked.rank} <= 2`)
    .orderBy(ranked.suiteId, ranked.rank);
  const regressed = rows.flatMap((newer, i) => {
    const older = rows[i + 1];
    return Number(newer.rank) === 1 &&
      older?.suiteId === newer.suiteId &&
      newer.failed > older.failed
      ? [newer.deploymentId]
      : [];
  });
  if (!regressed.length) return [];
  return tx
    .selectDistinct({ id: agents.id, slug: agents.slug })
    .from(deployments)
    .innerJoin(agents, eq(agents.id, deployments.agentId))
    .where(and(inArray(deployments.id, regressed), isNull(agents.archivedAt)))
    .orderBy(asc(agents.slug));
};

const developerCards = async (tx: Tx, userId: string, now: Date) => {
  const latest = await latestDeployments(tx);
  const reauth = await tx
    .select({ slug: mcpServers.slug })
    .from(mcpConnections)
    .innerJoin(mcpServers, eq(mcpServers.id, mcpConnections.serverId))
    .where(inArray(mcpConnections.status, ["needs_reauth", "revoked"]))
    .orderBy(asc(mcpServers.slug));
  const [failed] = await tx
    .select({ n: count() })
    .from(cases)
    .where(
      and(
        eq(cases.status, "failed"),
        gte(cases.updatedAt, new Date(now.getTime() - DAY)),
      ),
    );
  const regressed = await regressedAgents(tx);
  const sources = await tx
    .selectDistinct({ source: deployments.source })
    .from(deployments)
    .where(eq(deployments.createdBy, userId));
  const [ranCase] = await tx
    .select({ id: cases.id })
    .from(cases)
    .where(eq(cases.createdBy, userId))
    .limit(1);
  const [server] = await tx
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .limit(1);
  const [link] = await tx
    .select({ id: githubLinks.id })
    .from(githubLinks)
    .limit(1);

  const broken = [
    ...latest
      .filter((d) => d.status === "failed")
      .map((d) =>
        card(
          "fix-failed-deploy",
          { agent: { id: d.agentId, slug: d.slug } },
          d.agentId,
        ),
      ),
    ...reauth.map((s) => card("reconnect-mcp", { name: s.slug }, s.slug)),
    ...latest.flatMap((d) => {
      const secret =
        d.status === "waiting" ? d.waitingFor.secrets?.[0] : undefined;
      return secret
        ? [
            card(
              "add-missing-secret",
              { agent: { id: d.agentId, slug: d.slug }, name: secret },
              `${d.agentId}:${secret}`,
            ),
          ]
        : [];
    }),
    ...(failed?.n ? [card("review-failed-cases", { count: failed.n })] : []),
    ...regressed.map((a) => card("review-eval-regression", { agent: a }, a.id)),
  ];
  const setup: SetupCard[] = [];
  if (!sources.some((s) => s.source === "cli")) setup.push("install-cli");
  if (!sources.length) setup.push("deploy-template");
  if (!ranCase) setup.push("run-test-case");
  if (!server) setup.push("connect-mcp");
  if (!link) setup.push("link-repository");
  return { broken, setup };
};

const managerCards = async (
  env: Env,
  tx: Tx,
  org: string,
  plan: Plan,
  now: Date,
) => {
  const [agent] = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(isNull(agents.archivedAt))
    .limit(1);
  const [members] = await tx
    .select({ n: count() })
    .from(member)
    .where(eq(member.organizationId, org));
  const [pending] = await tx
    .select({ n: count() })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, org),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, now),
      ),
    );
  const [group] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.isDevelopers, false))
    .limit(1);
  const [sso] = await tx
    .select({ id: ssoProvider.id })
    .from(ssoProvider)
    .where(eq(ssoProvider.organizationId, org))
    .limit(1);
  const [removed] = await tx
    .select({ n: count() })
    .from(groups)
    .where(isNotNull(groups.syncedRemovedAt));

  const license = runMode(env).kind === "cloud" ? null : plan.license;
  const expiresAt =
    license && "license" in license ? license.license.expiresAt : null;
  const renew =
    expiresAt && expiresAt.getTime() - now.getTime() < 30 * DAY
      ? expiresAt
      : null;

  const broken = [
    ...(removed?.n ? [card("fix-directory-sync", { count: removed.n })] : []),
    ...(renew ? [card("renew-license", { at: renew.toISOString() })] : []),
    ...(pending?.n ? [card("review-invitations", { count: pending.n })] : []),
  ];
  const setup: SetupCard[] = [];
  if (!agent) setup.push("deploy-first-agent");
  if ((members?.n ?? 0) <= 1 && !pending?.n) setup.push("invite-team");
  if (!group) setup.push("create-group");
  if (plan.has("sso") && !sso) setup.push("set-up-sso");
  return { broken, setup };
};

// Started (by creation), done and failed (by when they finished) in each of
// the last 24 hours, oldest first.
const activityHours = async (tx: Tx, since: Date) => {
  const rows = await tx
    .select({
      createdAt: cases.createdAt,
      finishedAt:
        sql<Date>`coalesce(${cases.completedAt}, ${cases.updatedAt})`.mapWith(
          (value: string | Date) => new Date(value),
        ),
      status: cases.status,
    })
    .from(cases)
    .where(
      or(
        gte(cases.createdAt, since),
        and(
          inArray(cases.status, ["completed", "failed"]),
          gte(cases.updatedAt, since),
        ),
      ),
    );
  const hours = Array.from({ length: 24 }, () => ({
    started: 0,
    done: 0,
    failed: 0,
  }));
  const slot = (at: Date) =>
    hours[Math.min(23, Math.floor((at.getTime() - since.getTime()) / HOUR))];
  for (const row of rows) {
    if (row.createdAt >= since) slot(row.createdAt)!.started += 1;
    if (row.finishedAt < since) continue;
    if (row.status === "completed") slot(row.finishedAt)!.done += 1;
    if (row.status === "failed") slot(row.finishedAt)!.failed += 1;
  }
  return hours;
};

export const homeRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/home",
      tags: ["Home"],
      summary: "The signed-in person's home page",
      request: { params: OrgParam },
      responses: {
        200: {
          content: { "application/json": { schema: Home } },
          description: "Roles, cards and page previews",
        },
        403: { description: "Called with an API key" },
      },
    }),
    async (c) => {
      const userId = person(c.var.caller);
      const org = c.var.org;
      const now = new Date();
      const since = new Date(now.getTime() - DAY);
      const manager =
        c.var.caller.role === "owner" || c.var.caller.role === "admin";
      const plan = manager ? await getPlan(c.env, org) : null;

      const home = await withOrg(c.env, org, async (tx) => {
        const grants = await tx
          .select({
            isDevelopers: groups.isDevelopers,
            access: agentGrants.access,
          })
          .from(groupMembers)
          .innerJoin(groups, eq(groups.id, groupMembers.groupId))
          .leftJoin(agentGrants, eq(agentGrants.groupId, groups.id))
          .where(eq(groupMembers.userId, userId));
        const roles = {
          owner: c.var.caller.role === "owner",
          admin: c.var.caller.role === "admin",
          developer: grants.some((g) => g.isDevelopers),
          operator: grants.some((g) => g.access === "operator"),
          viewer: grants.some((g) => g.access === "viewer"),
        };
        const builds = roles.developer || manager;

        const managing = plan
          ? await managerCards(c.env, tx, org, plan, now)
          : null;
        const developing = roles.developer
          ? await developerCards(tx, userId, now)
          : null;
        const [worked] = roles.operator
          ? await tx
              .select({ month: seatActivity.month })
              .from(seatActivity)
              .where(
                and(
                  eq(seatActivity.userId, userId),
                  eq(seatActivity.role, "operator"),
                ),
              )
              .limit(1)
          : [];
        const dismissed = await tx
          .select({ card: homeDismissals.card })
          .from(homeDismissals)
          .where(eq(homeDismissals.userId, userId));
        const gone = new Set(dismissed.map((d) => d.card));
        const known = dismissed
          .map((d) => d.card)
          .filter((name): name is SetupCard =>
            (SETUP_CARDS as readonly string[]).includes(name),
          );
        const setup = [
          ...new Set([
            ...(managing?.setup ?? []),
            ...(developing?.setup ?? []),
            ...(roles.operator && !worked
              ? (["open-first-case"] as const)
              : []),
          ]),
        ].filter((name) => !gone.has(name));

        const visible = await visibleAgents(tx, c.var.caller);
        const recent =
          visible === null || visible.length
            ? await tx
                .select({
                  id: cases.id,
                  agentId: cases.agentId,
                  slug: agents.slug,
                  title: cases.title,
                  status: cases.status,
                  updatedAt: cases.updatedAt,
                })
                .from(cases)
                .innerJoin(agents, eq(agents.id, cases.agentId))
                .innerJoin(deployments, eq(deployments.id, cases.deploymentId))
                .where(
                  and(
                    eq(deployments.environment, "production"),
                    visible ? inArray(cases.agentId, visible) : undefined,
                  ),
                )
                .orderBy(desc(cases.updatedAt))
                .limit(4)
            : null;

        const latest = builds ? await latestDeployments(tx) : [];
        const members = manager
          ? {
              count:
                (
                  await tx
                    .select({ n: count() })
                    .from(member)
                    .where(eq(member.organizationId, org))
                )[0]?.n ?? 0,
              groups:
                (
                  await tx
                    .select({ n: count() })
                    .from(groups)
                    .where(eq(groups.isDevelopers, false))
                )[0]?.n ?? 0,
              seats: {
                used: await countSeats(tx),
                limit: plan?.limits.seats ?? null,
              },
              people: await tx
                .select({ id: user.id, name: user.name, image: user.image })
                .from(member)
                .innerJoin(user, eq(user.id, member.userId))
                .where(eq(member.organizationId, org))
                .orderBy(asc(member.createdAt))
                .limit(5),
            }
          : null;

        return {
          roles,
          cards: [
            ...(managing?.broken ?? []),
            ...(developing?.broken ?? []),
            ...setup.map((name) => card(name)),
          ],
          dismissed: known,
          agents: builds
            ? {
                total: latest.length,
                items: [...latest]
                  .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                  .slice(0, 4)
                  .map((d) => ({
                    slug: d.slug,
                    status: d.status,
                    live: d.live,
                  })),
              }
            : null,
          cases: recent && {
            items: recent.map((r) => ({
              id: r.id,
              agent: { id: r.agentId, slug: r.slug },
              title: r.title,
              status: r.status,
              updatedAt: r.updatedAt.toISOString(),
            })),
          },
          activity: builds
            ? {
                since: since.toISOString(),
                hours: await activityHours(tx, since),
              }
            : null,
          members,
        };
      });
      return c.json(home, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/home/dismissed/{card}",
      tags: ["Home"],
      summary: "Dismiss a first-time home card for the signed-in person",
      request: { params: OrgParam.extend({ card: z.enum(SETUP_CARDS) }) },
      responses: {
        204: { description: "Dismissed; dismissing again changes nothing" },
        403: { description: "Called with an API key" },
      },
    }),
    async (c) => {
      const userId = person(c.var.caller);
      const { card: name } = c.req.valid("param");
      await withOrg(c.env, c.var.org, (tx) =>
        tx
          .insert(homeDismissals)
          .values({ organizationId: c.var.org, userId, card: name })
          .onConflictDoNothing(),
      );
      return c.body(null, 204);
    },
  );
