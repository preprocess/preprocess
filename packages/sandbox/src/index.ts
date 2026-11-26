// A sandbox's awake intervals (spec 16a), reported by the Durable Object that
// owns its container to the API, which stamps the time and bills case
// sandboxes (apps/api/src/sandbox.ts). While the container runs, the Durable
// Object heartbeats every 30 seconds on an alarm; an interval that ends
// without a sleep or destroy event ends at its last heartbeat.

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
};

export type SandboxReporter = {
  sandboxEvent(event: SandboxEvent): Promise<void>;
};

export const HEARTBEAT_MS = 30_000;

type Interval = Omit<SandboxEvent, "type">;

// One per Durable Object. Call begin() right after starting or waking the
// container, end() after it sleeps, is destroyed or is found dead, and
// heartbeat() from the Durable Object's alarm.
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
    });
    await this.report(interval, type);
    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }

  // From the alarm: a heartbeat while the container runs; a crash, closed at
  // the last heartbeat, once it doesn't.
  async heartbeat(running: boolean) {
    const interval = await this.ctx.storage.get<Interval>("sandbox:open");
    if (!interval) return;
    if (!running) return this.close(interval, "crash");
    await this.report(interval, "heartbeat");
    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }

  async end(type: "sleep" | "destroy" | "crash") {
    const interval = await this.ctx.storage.get<Interval>("sandbox:open");
    if (interval) await this.close(interval, type);
  }

  private async close(interval: Interval, type: "sleep" | "destroy" | "crash") {
    await this.ctx.storage.delete("sandbox:open");
    await this.ctx.storage.deleteAlarm();
    await this.report(interval, type);
  }

  // Metering never fails the work; a lost event under-bills.
  private async report(interval: Interval, type: SandboxEvent["type"]) {
    try {
      await this.reporter?.sandboxEvent({ ...interval, type });
    } catch (error) {
      console.error("sandbox: report", type, interval.sandboxId, error);
    }
  }
}
