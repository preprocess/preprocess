// Deleting an organization removes everything it owns (help article "Cancel
// your Team plan or delete an organization"). Its Postgres rows go by cascade
// in the delete's own transaction. What lives outside Postgres goes after the
// commit, from the JOBS queue, in bounded steps: first each Durable Object it
// owns (cases with their sandboxes, schedulers, build queues) with the
// PostHog persons of members it leaves in no organization, then its R2
// objects (files, job results, support attachments, run logs, run capture,
// agent bundles and custom environment layers).
//
// The objects are named from rows the cascade removes, so the delete copies
// their names into organization_purge_objects first (snapshotPurge). Every
// step is safe to repeat, so a message delivered twice, a step that fails
// and is retried, and the minute cron's resend of a purge that stalled
// (resumePurges) all end in the same place. Completion is one log line with
// the organization's id and counts.

import { withoutOrg } from "@preprocess/db/client";
import type { SystemTx } from "@preprocess/db/client";
import { member } from "@preprocess/db/schema/auth";
import {
  organizationPurgeObjects,
  organizationPurges,
} from "@preprocess/db/schema/purges";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { queueName } from "./builds.ts";
import type { Env, Job } from "./env.ts";
import { schedulerName } from "./scheduler.ts";

// Durable Objects per step and at a time, and R2 listings (up to 1,000 keys
// each) per step, so a step stays well inside a Worker's limits.
export const OBJECTS_PER_STEP = 100;
const CONCURRENCY = 10;
export const PAGES_PER_STEP = 20;
// Steps per queue message before it hands the rest to a new message.
const STEPS_PER_MESSAGE = 10;
// A purge no step has worked on for this long is sent again.
const STALLED_MS = 10 * 60_000;

export type PurgeJob = Extract<Job, { kind: "organization.purge" }>;
export const purgeJob = (organizationId: string): PurgeJob => ({
  kind: "organization.purge",
  organizationId,
});

// In the delete's transaction, before the cascade: the purge row and the
// name of every Durable Object the organization's rows point to. Eval cases
// are named as evals.ts evalCaseId names them.
export const snapshotPurge = async (tx: SystemTx, org: string) => {
  await tx
    .insert(organizationPurges)
    .values({ organizationId: org })
    .onConflictDoNothing();
  await tx.execute(sql`
    insert into organization_purge_objects (organization_id, kind, agent, name)
    select organization_id, 'case', agent_id, id from cases
      where organization_id = ${org}
    union
    select r.organization_id, 'case', d.agent_id, 'eval:' || r.id || ':' || e.case_id
      from eval_results e
      join eval_runs r on r.id = e.run_id
      join deployments d on d.id = r.deployment_id
      where r.organization_id = ${org}
    union
    select organization_id, 'scheduler', id, '' from agents
      where organization_id = ${org}
    union
    select organization_id, 'scheduler', agent_id, id from deployments
      where organization_id = ${org} and environment = 'preview'
    union
    select organization_id, 'builds', agent_slug, branch from github_builds
      where organization_id = ${org}
    union
    select organization_id, 'person', '', user_id from member
      where organization_id = ${org}
    on conflict do nothing`);
};

const addCounts = (tx: SystemTx, org: string, counts: Record<string, number>) =>
  tx
    .update(organizationPurges)
    .set({
      counts: sql`(select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
        select k, sum(n) as n from (
          select key as k, value::text::bigint as n from jsonb_each(${organizationPurges.counts})
          union all
          select key, value::text::bigint from jsonb_each(${JSON.stringify(counts)}::jsonb)
        ) parts group by k) totals)`,
    })
    .where(eq(organizationPurges.organizationId, org));

type Named = { kind: string; agent: string; name: string };

// PostHog's API host for its ingestion host (us.i.posthog.com is
// us.posthog.com); a self-hosted PostHog serves both on one host.
const posthogApi = (env: Env) =>
  (env.POSTHOG_HOST || "https://us.i.posthog.com").replace(
    /^https:\/\/(us|eu)\.i\.posthog\.com/,
    "https://$1.posthog.com",
  );

// The PostHog persons (their distinct id is the user id) of these members
// that belong to no organization any more, with their events. Returns how
// many were deleted; none when PostHog deletion isn't configured.
const deletePersons = async (env: Env, users: string[]) => {
  if (!users.length || !env.POSTHOG_PERSONAL_API_KEY || !env.POSTHOG_PROJECT_ID)
    return 0;
  const members = await withoutOrg(env, "organization purge: members", (tx) =>
    tx
      .selectDistinct({ userId: member.userId })
      .from(member)
      .where(inArray(member.userId, users)),
  );
  const still = new Set(members.map((m) => m.userId));
  const gone = users.filter((u) => !still.has(u));
  if (!gone.length) return 0;
  const response = await fetch(
    `${posthogApi(env)}/api/projects/${env.POSTHOG_PROJECT_ID}/persons/bulk_delete/`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.POSTHOG_PERSONAL_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ distinct_ids: gone, delete_events: true }),
    },
  );
  if (!response.ok)
    throw new Error(`PostHog person deletion answered ${response.status}`);
  return gone.length;
};

const wipe = (env: Env, org: string, o: Named) => {
  if (o.kind === "case")
    return env.RUNTIME.deleteCase({
      organizationId: org,
      agentId: o.agent,
      caseId: o.name,
    });
  if (o.kind === "scheduler")
    return env.SCHEDULER.getByName(
      schedulerName(org, o.agent, o.name || undefined),
    ).wipe();
  return env.BUILDS.getByName(queueName(org, o.agent, o.name)).wipe();
};

// One step of the Durable Objects: wiped, then struck from the list. True
// once the list is empty.
const purgeObjects = async (env: Env, org: string) => {
  const due = await withoutOrg(env, "organization purge: objects", (tx) =>
    tx
      .select()
      .from(organizationPurgeObjects)
      .where(eq(organizationPurgeObjects.organizationId, org))
      .orderBy(
        asc(organizationPurgeObjects.kind),
        asc(organizationPurgeObjects.agent),
        asc(organizationPurgeObjects.name),
      )
      .limit(OBJECTS_PER_STEP),
  );
  if (!due.length) return true;
  const objects = due.filter((o) => o.kind !== "person");
  for (let i = 0; i < objects.length; i += CONCURRENCY)
    await Promise.all(
      objects.slice(i, i + CONCURRENCY).map((o) => wipe(env, org, o)),
    );
  const counts: Record<string, number> = {
    posthogPersons: await deletePersons(
      env,
      due.filter((o) => o.kind === "person").map((o) => o.name),
    ),
  };
  for (const o of due) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
  await withoutOrg(env, "organization purge: objects wiped", async (tx) => {
    for (const o of due)
      await tx
        .delete(organizationPurgeObjects)
        .where(
          and(
            eq(organizationPurgeObjects.organizationId, org),
            eq(organizationPurgeObjects.kind, o.kind),
            eq(organizationPurgeObjects.agent, o.agent),
            eq(organizationPurgeObjects.name, o.name),
          ),
        );
    await addCounts(tx, org, counts);
  });
  return due.length < OBJECTS_PER_STEP;
};

// One step of the R2 objects: the API's buckets, then the runtime's. True
// once nothing is left under any of the organization's prefixes.
const purgeR2 = async (env: Env, org: string) => {
  const prefixes = [
    { bucket: env.FILES, prefix: `${org}/`, count: "files" },
    { bucket: env.FILES, prefix: `support/${org}/`, count: "files" },
    { bucket: env.LOG_BUCKET, prefix: `${org}/`, count: "logs" },
  ];
  const counts: Record<string, number> = {};
  let pages = PAGES_PER_STEP;
  const ours = async () => {
    for (const { bucket, prefix, count } of prefixes)
      for (;;) {
        if (pages-- <= 0) return false;
        const page = await bucket.list({ prefix });
        if (!page.objects.length) break;
        await bucket.delete(page.objects.map((o) => o.key));
        counts[count] = (counts[count] ?? 0) + page.objects.length;
      }
    return true;
  };
  let done = await ours();
  if (done) {
    const runtime = await env.RUNTIME.deleteOrganizationObjects(org, pages);
    counts.runs = runtime.runs;
    counts.bundles = runtime.bundles;
    done = runtime.done;
  }
  await withoutOrg(env, "organization purge: objects deleted", (tx) =>
    addCounts(tx, org, counts),
  );
  return done;
};

// One step of a deleted organization's purge: "more" while anything is left,
// "done" once it completes, "none" when it has no open purge.
export const purgeStep = async (env: Env, org: string) => {
  // Its id starts every key it owns; one that could widen a prefix is refused.
  if (!/^[\w-]+$/.test(org))
    throw new Error(`refusing to purge organization "${org}"`);
  const [open] = await withoutOrg(env, "organization purge: start", (tx) =>
    tx
      .update(organizationPurges)
      .set({ attemptedAt: new Date() })
      .where(
        and(
          eq(organizationPurges.organizationId, org),
          isNull(organizationPurges.completedAt),
        ),
      )
      .returning(),
  );
  if (!open) return "none";
  if (!(await purgeObjects(env, org))) return "more";
  if (!(await purgeR2(env, org))) return "more";
  const [completed] = await withoutOrg(
    env,
    "organization purge: complete",
    (tx) =>
      tx
        .update(organizationPurges)
        .set({ completedAt: new Date() })
        .where(
          and(
            eq(organizationPurges.organizationId, org),
            isNull(organizationPurges.completedAt),
          ),
        )
        .returning(),
  );
  if (completed)
    console.log(
      JSON.stringify({
        event: "organization.purged",
        organizationId: org,
        requestedAt: completed.requestedAt.toISOString(),
        completedAt: completed.completedAt?.toISOString(),
        counts: completed.counts,
      }),
    );
  return "done";
};

// A queue message's share of the purge; what is left goes to a new message.
export const runPurgeJob = async (env: Env, job: PurgeJob) => {
  for (let step = 0; step < STEPS_PER_MESSAGE; step++)
    if ((await purgeStep(env, job.organizationId)) !== "more") return;
  await env.JOBS.send(job);
};

// From the minute cron: sends again each purge that is not complete and that
// no step has worked on lately, such as one whose send after the delete
// failed or whose message ran out of retries.
export const resumePurges = async (env: Env, now = new Date()) => {
  const cutoff = new Date(now.getTime() - STALLED_MS);
  const stalled = await withoutOrg(env, "organization purge: stalled", (tx) =>
    tx
      .select({ organizationId: organizationPurges.organizationId })
      .from(organizationPurges)
      .where(
        and(
          isNull(organizationPurges.completedAt),
          or(
            lt(organizationPurges.attemptedAt, cutoff),
            and(
              isNull(organizationPurges.attemptedAt),
              lt(organizationPurges.requestedAt, cutoff),
            ),
          ),
        ),
      )
      .limit(100),
  );
  if (stalled.length)
    await env.JOBS.sendBatch(
      stalled.map((p) => ({ body: purgeJob(p.organizationId) })),
    );
  return stalled.length;
};
