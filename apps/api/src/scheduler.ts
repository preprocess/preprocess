// Schedules (design doc 04): one scheduler Durable Object per organization
// and agent ("<org>:<agent>:scheduler") holds the production deployment's
// schedules, and one per preview deployment ("…:scheduler:<deploymentId>")
// holds a preview's. Each sets an alarm for the next fire time. A fire creates
// a case with source "schedule" and the idempotency key
// "schedule:<name>:<fireTime>", so a retried alarm never makes a second case;
// fires missed while the object was unavailable run once, not once per
// interval. Pauses are kept by name apart from the schedule list, so a
// promotion keeps them.

import { orgId, withOrg } from "@preprocess/db/client";
import { deployments } from "@preprocess/db/schema/deployments";
import { Cron } from "croner";
import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";

import { ApiError, createCase } from "./cases.ts";
import type { Manifest } from "./deploy.ts";
import { liveDeployments } from "./deploy.ts";
import type { Env } from "./env.ts";
import { effectiveSettings } from "./settings.ts";

export type Schedule = NonNullable<Manifest["schedules"]>[number];

type Plan = {
  organizationId: string;
  agentId: string;
  // Set for a preview's scheduler; production fires on whichever deployment
  // is promoted when it fires.
  previewId: string | null;
  schedules: Schedule[];
};

type Run = {
  next: string | null;
  lastCaseId: string | null;
  // Why the last fire made no case, e.g. spending_limit_reached. A refused
  // fire is recorded here and not retried.
  lastError: string | null;
};

export const nextFire = (schedule: Schedule, after: Date) =>
  new Cron(schedule.cron, { timezone: schedule.timezone, paused: true })
    .nextRun(after)
    ?.toISOString() ?? null;

export const schedulerName = (
  organizationId: string,
  agentId: string,
  previewId?: string,
) =>
  `${organizationId}:${agentId}:scheduler${previewId ? `:${previewId}` : ""}`;

export type ScheduleView = {
  name: string;
  cron: string;
  timezone: string;
  paused: boolean;
  nextRunAt: string | null;
  lastCaseId: string | null;
  lastError: string | null;
};

export class Scheduler extends DurableObject<Env> {
  private async read() {
    const [plan, paused, runs] = await Promise.all([
      this.ctx.storage.get<Plan>("plan"),
      this.ctx.storage.get<string[]>("paused"),
      this.ctx.storage.get<Record<string, Run>>("runs"),
    ]);
    return { plan, paused: paused ?? [], runs: runs ?? {} };
  }

  private async arm(runs: Record<string, Run>, paused: string[]) {
    const next = Object.entries(runs)
      .filter(([name, run]) => run.next && !paused.includes(name))
      .map(([, run]) => Date.parse(run.next!))
      .sort((a, b) => a - b)[0];
    if (next === undefined) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  // On promotion (production) or deploy (preview): the deployment's
  // schedules replace the old ones. Pauses of names that remain are kept.
  async replace(plan: Plan) {
    const before = await this.read();
    const names = plan.schedules.map((s) => s.name);
    const paused = before.paused.filter((n) => names.includes(n));
    const now = new Date();
    const runs = Object.fromEntries(
      plan.schedules.map((s) => [
        s.name,
        {
          next: nextFire(s, now),
          lastCaseId: before.runs[s.name]?.lastCaseId ?? null,
          lastError: before.runs[s.name]?.lastError ?? null,
        },
      ]),
    );
    await this.ctx.storage.put({ plan, paused, runs });
    await this.arm(runs, paused);
  }

  async list(): Promise<ScheduleView[]> {
    const { plan, paused, runs } = await this.read();
    return (plan?.schedules ?? []).map((s) => ({
      name: s.name,
      cron: s.cron,
      timezone: s.timezone,
      paused: paused.includes(s.name),
      nextRunAt: paused.includes(s.name) ? null : (runs[s.name]?.next ?? null),
      lastCaseId: runs[s.name]?.lastCaseId ?? null,
      lastError: runs[s.name]?.lastError ?? null,
    }));
  }

  // False when the schedule does not exist.
  async setPaused(name: string, pause: boolean) {
    const { plan, paused, runs } = await this.read();
    const schedule = plan?.schedules.find((s) => s.name === name);
    if (!schedule) return false;
    const next = pause
      ? [...new Set([...paused, name])]
      : paused.filter((n) => n !== name);
    // Unpausing starts from now: what was missed while paused does not run.
    if (!pause && paused.includes(name))
      runs[name] = { ...runs[name]!, next: nextFire(schedule, new Date()) };
    await this.ctx.storage.put({ paused: next, runs });
    await this.arm(runs, next);
    return true;
  }

  // For a preview: whether its deployment is still live, and which of its
  // schedules the agent's settings let run on previews.
  private async previewState(plan: Plan, previewId: string) {
    return withOrg(this.env, orgId(plan.organizationId), async (tx) => {
      const live = (await liveDeployments(tx, plan.agentId)).some(
        (d) => d.id === previewId,
      );
      if (!live) return null;
      const [deployment] = await tx
        .select({ manifest: deployments.manifest })
        .from(deployments)
        .where(eq(deployments.id, previewId));
      const settings = await effectiveSettings(
        tx,
        plan.agentId,
        deployment!.manifest as Manifest,
      );
      return settings.schedules;
    });
  }

  override async alarm() {
    const { plan, paused, runs } = await this.read();
    if (!plan) return;
    const now = new Date();
    const due = plan.schedules.filter(
      (s) =>
        !paused.includes(s.name) &&
        runs[s.name]?.next &&
        Date.parse(runs[s.name]!.next!) <= now.getTime(),
    );
    if (due.length === 0) return this.arm(runs, paused);
    const previews = plan.previewId
      ? await this.previewState(plan, plan.previewId)
      : undefined;
    // A preview that is no longer live stops its schedules for good.
    if (previews === null) {
      await this.ctx.storage.deleteAll();
      return;
    }
    for (const schedule of due) {
      const run = runs[schedule.name]!;
      if (!previews || previews[schedule.name]?.previews) {
        try {
          const { body } = await createCase(
            this.env,
            orgId(plan.organizationId),
            {
              agent: plan.agentId,
              ...(plan.previewId && { deployment: plan.previewId }),
              text: schedule.text,
              files: [],
            },
            {
              source: "schedule",
              createdBy: schedule.name,
              actorType: "platform",
            },
            `schedule:${schedule.name}:${run.next}`,
          );
          run.lastCaseId = body.id;
          run.lastError = null;
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          run.lastError = error.code;
        }
      }
      run.next = nextFire(schedule, now);
    }
    await this.ctx.storage.put("runs", runs);
    await this.arm(runs, paused);
  }
}
