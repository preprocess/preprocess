// A sandbox's awake intervals (spec 16a), reported by the Durable Object that
// owns its container to the API, which bills case sandboxes
// (apps/api/src/sandbox.ts). Each event carries the time the Durable Object
// saw it: a start is timed when the container was asked to start, a stop when
// the container was seen to stop. The Durable Object checks its container
// every 5 seconds and heartbeats the API every 30; a container found gone
// without a stop event ends at the last check that saw it running.

export type SandboxOwner = {
  organizationId: string;
  agent?: string | undefined;
  caseId?: string | undefined;
};

export type SandboxEvent = SandboxOwner & {
  // The sandbox's own id (its Durable Object's), and which of its awake
  // intervals this is, from 1.
  sandboxId: string;
  seq: number;
  type: "start" | "wake" | "heartbeat" | "sleep" | "destroy" | "crash";
  kind: "build" | "render" | "case";
  // A case sandbox's size id; for a build or render, the instance type.
  size: string;
  // When the event happened, as the Durable Object saw it (ISO 8601).
  at?: string;
};

export type SandboxReporter = {
  sandboxEvent(event: SandboxEvent): Promise<void>;
};

// How often the Durable Object checks its container, and how often it tells
// the API the sandbox is still awake.
export const CHECK_MS = 5_000;
export const HEARTBEAT_MS = 30_000;

type Interval = Omit<SandboxEvent, "type" | "at">;

// One per Durable Object. Call begin() with the time the container was asked
// to start or wake, end() with the time it was seen to sleep, be destroyed or
// die, and check() from the Durable Object's alarm.
export class SandboxMeter {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly reporter: SandboxReporter | undefined,
  ) {}

  async begin(
    owner: SandboxOwner,
    kind: SandboxEvent["kind"],
    size: string,
    type: "start" | "wake" = "start",
    at = new Date(),
  ) {
    const seq = ((await this.ctx.storage.get<number>("sandbox:seq")) ?? 0) + 1;
    const interval: Interval = {
      ...owner,
      sandboxId: this.ctx.id.toString(),
      seq,
      kind,
      size,
    };
    await this.ctx.storage.put({
      "sandbox:seq": seq,
      "sandbox:open": interval,
      "sandbox:seenAt": at.getTime(),
      "sandbox:reportedAt": Date.now(),
    });
    await this.report(interval, type, at);
    await this.ctx.storage.setAlarm(Date.now() + CHECK_MS);
  }

  // From the alarm: notes the container running, heartbeating the API every
  // HEARTBEAT_MS; once it is gone, closes the interval at the last check that
  // saw it running.
  async check(running: boolean) {
    const interval = await this.ctx.storage.get<Interval>("sandbox:open");
    if (!interval) return;
    if (!running) return this.end("crash");
    const now = Date.now();
    await this.ctx.storage.put("sandbox:seenAt", now);
    const reported =
      (await this.ctx.storage.get<number>("sandbox:reportedAt")) ?? 0;
    if (now - reported >= HEARTBEAT_MS) {
      await this.ctx.storage.put("sandbox:reportedAt", now);
      await this.report(interval, "heartbeat", new Date(now));
    }
    await this.ctx.storage.setAlarm(now + CHECK_MS);
  }

  // `at` is when the container was seen to stop; a crash nobody saw ends at
  // the last check that saw it running.
  async end(type: "sleep" | "destroy" | "crash", at?: Date) {
    const interval = await this.ctx.storage.get<Interval>("sandbox:open");
    if (!interval) return;
    const seenAt = await this.ctx.storage.get<number>("sandbox:seenAt");
    await this.ctx.storage.delete([
      "sandbox:open",
      "sandbox:seenAt",
      "sandbox:reportedAt",
    ]);
    await this.ctx.storage.deleteAlarm();
    await this.report(
      interval,
      type,
      at ?? (seenAt !== undefined ? new Date(seenAt) : new Date()),
    );
  }

  // Metering never fails the work; a lost event closes at the API's last
  // heartbeat.
  private async report(
    interval: Interval,
    type: SandboxEvent["type"],
    at: Date,
  ) {
    try {
      await this.reporter?.sandboxEvent({
        ...interval,
        type,
        at: at.toISOString(),
      });
    } catch (error) {
      console.error("sandbox: report", type, interval.sandboxId, error);
    }
  }
}
