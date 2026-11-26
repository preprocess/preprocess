// Moving from Team down to Free (PRE-96, Chip's flow): cancelling is never
// blocked and nothing is deleted. Each thing over Free's limits gets its own
// reversible consequence, shown before the Owner confirms:
// - seats past Free's: the Owner picks who keeps one (else Owners first, then
//   the most recently active); the rest leave their seat groups for the
//   Viewers group, which can view every agent they could see before, and
//   their groups are kept so a return to Team restores them;
// - agents with a custom environment pause (cases.ts refuses their new cases
//   while the plan lacks custom environments) and resume on Team;
// - storage past Free's 5 GB is billed to the card, as on Team;
// - cases past 1,000 a month wait for the next month, as Free always does.
// Credits and auto-reload carry over, and cases already running finish.

import { audit } from "@preprocess/db/audit";
import { orgId, withOrg, withoutOrg, type Tx } from "@preprocess/db/client";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import { newId } from "@preprocess/db/ids";
import { member, organization, user } from "@preprocess/db/schema/auth";
import {
  demotedSeats,
  planChanges,
  seatActivity,
} from "@preprocess/db/schema/billing";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";

import { autumn } from "./autumn.ts";
import { readPlan, storedBytes } from "./billing.ts";
import { planSwitchedEmail, seatEndingEmail } from "./email-templates.ts";
import { emailBrand, sendEmail } from "./email.ts";
import type { Env } from "./env.ts";
import { seatMemberships } from "./seats.ts";

// Free's limits, as in autumn.config.ts.
export const FREE_SEATS = 3;
const FREE_CASES = 1_000;
const FREE_STORAGE_GB = 5;
const STORAGE_USD_PER_GB_MONTH = 0.1;

const DAY = 86_400_000;
const WARN_BEFORE = 3 * DAY;

export type SeatPerson = {
  userId: string;
  name: string;
  email: string;
  keeps: boolean;
};

// Everyone holding a seat, those keeping one first: the Owner's picks when
// given, else Owners, then the most recently active.
export const seatPeople = async (
  tx: Tx,
  org: string,
  keep: string[] | null,
  limit = FREE_SEATS,
) => {
  const memberships = await seatMemberships(tx);
  const holders = [...new Set(memberships.map((m) => m.userId))];
  if (!holders.length) return { people: [] as SeatPerson[], memberships };
  const rows = await tx
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      active: sql<
        string | null
      >`(select max(${seatActivity.firstAt}) from ${seatActivity}
        where ${seatActivity.organizationId} = ${org} and ${seatActivity.userId} = ${user.id})`,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(eq(member.organizationId, org), inArray(member.userId, holders)),
    );
  const time = (at: string | null) => (at ? new Date(at).getTime() : 0);
  const rank = (r: (typeof rows)[number]) =>
    keep ? (keep.includes(r.userId) ? 0 : 1) : r.role === "owner" ? 0 : 1;
  rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      time(b.active) - time(a.active) ||
      a.name.localeCompare(b.name),
  );
  return {
    people: rows.map((r, i) => ({
      userId: r.userId,
      name: r.name,
      email: r.email,
      keeps: i < limit && (!keep || keep.includes(r.userId)),
    })),
    memberships,
  };
};

// Agents whose production deployment runs in a custom environment, which
// Free pauses.
export const customEnvironmentAgents = async (tx: Tx) => {
  const rows = await tx
    .select({
      id: agents.id,
      slug: agents.slug,
      layer: deployments.sandboxLayer,
    })
    .from(deployments)
    .innerJoin(agents, eq(agents.id, deployments.agentId))
    .where(
      and(
        isNull(agents.archivedAt),
        eq(deployments.status, "ready"),
        isNotNull(deployments.promotedAt),
      ),
    )
    .orderBy(desc(deployments.promotedAt));
  const seen = new Set<string>();
  const paused: { id: string; slug: string }[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (row.layer) paused.push({ id: row.id, slug: row.slug });
  }
  return paused.sort((a, b) => a.slug.localeCompare(b.slug));
};

export type ChangeItem =
  | { kind: "seats"; limit: number; people: SeatPerson[] }
  | { kind: "agents"; agents: { id: string; slug: string }[] }
  | {
      kind: "storage";
      gb: number;
      includedGb: number;
      usdPerMonth: number;
    }
  | { kind: "cases"; thisMonth: number; limit: number };

const monthStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// What moving to Free changes, from live usage: only what applies, so an
// empty list is "Nothing else changes".
export const changePreview = async (
  env: Env,
  org: string,
  keep: string[] | null = null,
  now = new Date(),
): Promise<ChangeItem[]> => {
  const items: ChangeItem[] = [];
  const { people, paused, monthCases } = await withOrg(
    env,
    orgId(org),
    async (tx) => {
      const [counted] = await tx
        .select({ n: count() })
        .from(cases)
        .where(gte(cases.createdAt, monthStart(now)));
      return {
        people: (await seatPeople(tx, org, keep)).people,
        paused: await customEnvironmentAgents(tx),
        monthCases: counted?.n ?? 0,
      };
    },
  );
  if (people.length > FREE_SEATS)
    items.push({ kind: "seats", limit: FREE_SEATS, people });
  if (paused.length) items.push({ kind: "agents", agents: paused });
  const [stored] = await withoutOrg(env, "billing: storage preview", (tx) =>
    storedBytes(tx, org),
  );
  const gb = (stored?.bytes ?? 0) / 1e9;
  if (gb > FREE_STORAGE_GB)
    items.push({
      kind: "storage",
      gb: Math.floor(gb * 100) / 100,
      includedGb: FREE_STORAGE_GB,
      usdPerMonth:
        Math.floor((gb - FREE_STORAGE_GB) * STORAGE_USD_PER_GB_MONTH * 100) /
        100,
    });
  if (monthCases > FREE_CASES)
    items.push({ kind: "cases", thisMonth: monthCases, limit: FREE_CASES });
  return items;
};

// Checks the Owner's picks: seat holders, at most Free's seats.
export const checkPicks = async (env: Env, org: string, keep: string[]) =>
  withOrg(env, orgId(org), async (tx) => {
    const holders = new Set((await seatMemberships(tx)).map((m) => m.userId));
    if (new Set(keep).size !== keep.length || keep.length > FREE_SEATS)
      return `Pick at most ${FREE_SEATS} people to keep a developer or operator seat.`;
    if (keep.some((id) => !holders.has(id)))
      return "Pick only people who currently have a developer or operator seat.";
    return null;
  });

export const recordChange = (
  env: Env,
  org: string,
  change: {
    plan: string;
    at: Date | null;
    keep: string[] | null;
    reason: string | null;
    by: string;
  },
) =>
  withOrg(env, orgId(org), async (tx) => {
    const values = {
      plan: change.plan,
      at: change.at,
      keep: change.keep,
      reason: change.reason,
      requestedBy: change.by,
      requestedAt: new Date(),
      warnedAt: null,
    };
    await tx
      .insert(planChanges)
      .values({ organizationId: org, ...values })
      .onConflictDoUpdate({ target: planChanges.organizationId, set: values });
  });

export const forgetChange = (env: Env, org: string) =>
  withOrg(env, orgId(org), (tx) =>
    tx.delete(planChanges).where(eq(planChanges.organizationId, org)),
  );

const sendOnce = async (
  env: Env,
  key: string,
  to: string,
  email: Parameters<typeof sendEmail>[2],
) => {
  if (await env.EMAILS_SENT.get(key)) return;
  await sendEmail(env, to, email);
  await env.EMAILS_SENT.put(key, "1", { expirationTtl: 7 * 86_400 });
};

const orgName = async (tx: Tx, org: string) => {
  const [row] = await tx
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, org));
  return row?.name ?? "Your organization";
};

type Change = typeof planChanges.$inferSelect;

// Three days before: tells each person losing a seat.
const warn = async (env: Env, change: Change, at: Date) => {
  const org = change.organizationId;
  const { losing, name } = await withOrg(env, orgId(org), async (tx) => ({
    losing: (await seatPeople(tx, org, change.keep)).people.filter(
      (p) => !p.keeps,
    ),
    name: await orgName(tx, org),
  }));
  for (const person of losing) {
    const email = seatEndingEmail(emailBrand(env), {
      url: new URL("/", env.APP_URL).href,
      orgName: name,
      at,
      email: person.email,
    });
    await sendOnce(
      env,
      `seat-ending:${org}:${person.userId}`,
      person.email,
      email,
    );
  }
  await withOrg(env, orgId(org), (tx) =>
    tx
      .update(planChanges)
      .set({ warnedAt: new Date() })
      .where(eq(planChanges.organizationId, org)),
  );
};

// The group demoted people join so they keep viewer access (Chip: they
// become free viewers): viewer grants on every agent the groups they left
// could see, all agents when they left Developers.
const VIEWERS = { slug: "free-viewers", name: "Viewers" };

const viewersGroup = async (tx: Tx, org: string) => {
  const [found] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.organizationId, org), eq(groups.slug, VIEWERS.slug)));
  if (found) return found.id;
  const id = newId("group");
  await tx.insert(groups).values({
    id,
    organizationId: org,
    ...VIEWERS,
    description:
      "People who lost a developer or operator seat when the organization moved to Free. They can view the agents they could see before.",
  });
  return id;
};

const keepViewing = async (
  tx: Tx,
  org: string,
  leaving: { userId: string; groupId: string }[],
) => {
  const left = [...new Set(leaving.map((m) => m.groupId))];
  const developers = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(and(inArray(groups.id, left), eq(groups.isDevelopers, true)));
  const seen = developers.length
    ? await tx
        .select({ agentId: agents.id })
        .from(agents)
        .where(isNull(agents.archivedAt))
    : await tx
        .selectDistinct({ agentId: agentGrants.agentId })
        .from(agentGrants)
        .where(inArray(agentGrants.groupId, left));
  const viewers = await viewersGroup(tx, org);
  if (seen.length)
    await tx
      .insert(agentGrants)
      .values(
        seen.map((a) => ({
          organizationId: org,
          agentId: a.agentId,
          groupId: viewers,
          access: "viewer" as const,
          grantedBy: "billing",
        })),
      )
      .onConflictDoNothing();
  await tx
    .insert(groupMembers)
    .values(
      [...new Set(leaving.map((m) => m.userId))].map((userId) => ({
        organizationId: org,
        groupId: viewers,
        userId,
      })),
    )
    .onConflictDoNothing();
};

// An agent created after the switch is visible to Viewers too, as it would
// have been to the Developers they left.
export const grantViewersNewAgent = async (
  tx: Tx,
  org: string,
  agentId: string,
) => {
  const [viewers] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.organizationId, org), eq(groups.slug, VIEWERS.slug)));
  if (!viewers) return;
  await tx
    .insert(agentGrants)
    .values({
      organizationId: org,
      agentId,
      groupId: viewers.id,
      access: "viewer",
      grantedBy: "billing",
    })
    .onConflictDoNothing();
};

// Once Free has started: leaves seats past Free's limit, keeping each
// person's groups to restore, and tells the Owners what changed.
export const switchToFree = async (
  env: Env,
  change: Change,
  limit = FREE_SEATS,
) => {
  const org = change.organizationId;
  const summary = await withOrg(env, orgId(org), async (tx) => {
    const { people, memberships } = await seatPeople(
      tx,
      org,
      change.keep,
      limit,
    );
    const losing = people.filter((p) => !p.keeps);
    const leaving = memberships.filter((m) =>
      losing.some((p) => p.userId === m.userId),
    );
    if (leaving.length) {
      await tx
        .insert(demotedSeats)
        .values(leaving.map((m) => ({ organizationId: org, ...m })))
        .onConflictDoNothing();
      for (const m of leaving)
        await tx
          .delete(groupMembers)
          .where(
            and(
              eq(groupMembers.groupId, m.groupId),
              eq(groupMembers.userId, m.userId),
            ),
          );
      await keepViewing(tx, org, leaving);
    }
    const paused = await customEnvironmentAgents(tx);
    await audit(tx, {
      organizationId: org,
      actorType: "platform",
      actorId: "billing",
      action: "billing.plan_switched",
      targetType: "organization",
      targetId: org,
      data: {
        plan: change.plan,
        reason: change.reason,
        demoted: losing.map((p) => p.userId),
        pausedAgents: paused.map((a) => a.id),
      },
    });
    await tx.delete(planChanges).where(eq(planChanges.organizationId, org));
    const owners = await tx
      .select({ email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, org), eq(member.role, "owner")));
    return {
      owners,
      name: await orgName(tx, org),
      demoted: losing.map((p) => p.name),
      pausedAgents: paused.map((a) => a.slug),
    };
  });
  const email = planSwitchedEmail(emailBrand(env), {
    url: new URL("/settings/organization", env.APP_URL).href,
    orgName: summary.name,
    demoted: summary.demoted,
    pausedAgents: summary.pausedAgents,
  });
  for (const owner of summary.owners)
    await sendOnce(
      env,
      `plan-switched:${org}:${owner.email}`,
      owner.email,
      email,
    );
  console.log("billing: switched to Free", org, summary.demoted.length);
};

// Every minute: warns three days before a waiting move to Free, and applies
// it once Team's period has ended. Only due changes ask Autumn.
export const runPlanChanges = async (env: Env, now = new Date()) => {
  const billing = autumn(env);
  if (!billing) return;
  const waiting = await withoutOrg(env, "billing: plan changes", (tx) =>
    tx.select().from(planChanges),
  );
  for (const change of waiting) {
    const org = change.organizationId;
    try {
      if (
        change.at &&
        !change.warnedAt &&
        change.at.getTime() - WARN_BEFORE <= now.getTime()
      )
        await warn(env, change, change.at);
      if (change.at && change.at > now) continue;
      const plan = readPlan(await billing.customer(org));
      if (plan.name === "team" && plan.change) continue;
      if (plan.name === "free" && plan.started)
        await switchToFree(env, change, plan.seats ?? FREE_SEATS);
      else await forgetChange(env, org);
    } catch (error) {
      console.error("billing: plan change", org, error);
    }
  }
};

// The people whose seats Team's end took, for the Billing banner.
export const demotedPeople = (tx: Tx) =>
  tx.selectDistinct({ userId: demotedSeats.userId }).from(demotedSeats);

// Back on Team: everyone returns to the seat groups they left, where those
// groups still exist. Returns how many people.
export const restoreRoles = (
  env: Env,
  org: string,
  by: { actorType: "person"; actorId: string },
) =>
  withOrg(env, orgId(org), async (tx) => {
    const rows = await tx
      .select()
      .from(demotedSeats)
      .where(eq(demotedSeats.organizationId, org));
    const existing = new Set(
      (
        await tx
          .select({ id: groups.id })
          .from(groups)
          .where(eq(groups.organizationId, org))
      ).map((g) => g.id),
    );
    const back = rows.filter((r) => existing.has(r.groupId));
    if (back.length)
      await tx
        .insert(groupMembers)
        .values(
          back.map((r) => ({
            organizationId: org,
            groupId: r.groupId,
            userId: r.userId,
          })),
        )
        .onConflictDoNothing();
    const [viewers] = await tx
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(eq(groups.organizationId, org), eq(groups.slug, VIEWERS.slug)),
      );
    if (viewers && rows.length)
      await tx
        .delete(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, viewers.id),
            inArray(groupMembers.userId, [
              ...new Set(rows.map((r) => r.userId)),
            ]),
          ),
        );
    await tx.delete(demotedSeats).where(eq(demotedSeats.organizationId, org));
    const people = new Set(rows.map((r) => r.userId)).size;
    await audit(tx, {
      organizationId: org,
      ...by,
      action: "billing.roles_restored",
      targetType: "organization",
      targetId: org,
      data: { people, memberships: back.length },
    });
    return people;
  });
