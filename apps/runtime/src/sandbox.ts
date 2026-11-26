// Case sandboxes (spec 3): one Linux container per case, started on the
// agent's first sandbox call and destroyed when the case closes. A sandbox is
// a Durable Object named like its case runtime, "<org>:<agent>:<case>", in the
// class for its size; each class starts one Cloudflare instance type. The
// image is a platform preset from the Worker's images map, never anything a
// case supplies. Every HTTP and HTTPS request the container makes goes through
// the Outbound entrypoint with the deployment's network rules, the same
// gateway agent code uses; nothing else leaves it.
//
// Files go through the Sandbox SDK's Files, which runs the image's
// sandbox-shim. The container's awake time is reported through SandboxMeter
// (@preprocess/sandbox) to the API, which times and bills it.

import { Files } from "@cloudflare/sandbox";
import { initLogs, wideEvent } from "@preprocess/logs";
import { SandboxMeter, type SandboxOwner } from "@preprocess/sandbox";
import type {
  SandboxManifest,
  SandboxPreset,
  SandboxSize,
} from "@preprocess/sdk/protocol";
import { DurableObject } from "cloudflare:workers";

import type { DeploymentRef, Env, NetworkRules } from "./env.ts";
import {
  LAYER_BUILD_SECONDS,
  LAYER_INSTANCE,
  LAYER_LOG_CHARS,
  layerBuilderName,
  layerKey,
  ownsLayer,
  parseLayerSizes,
  type Layer,
  type LayerJob,
  type LayerResult,
  type QueuedLayer,
} from "./layers.ts";
import type { OutboundProps } from "./outbound.ts";

// Each size's Cloudflare instance type (PRE-87; developers.cloudflare.com/
// containers/pricing, 2026-11-26).
export const SANDBOX_INSTANCE = {
  small: "standard-1",
  medium: "standard-2",
  large: "standard-4",
} as const satisfies Record<SandboxSize, string>;

// Each preset's key in ctx.container.images: the Container ids in
// infra/alchemy.run.ts.
export const SANDBOX_IMAGE = {
  standard: "SandboxStandard",
  node: "SandboxNode",
  python: "SandboxPython",
  "python-data": "SandboxPythonData",
} as const satisfies Record<SandboxPreset, string>;

export const SANDBOX_BINDING = {
  small: "SANDBOX_SMALL",
  medium: "SANDBOX_MEDIUM",
  large: "SANDBOX_LARGE",
} as const satisfies Record<SandboxSize, string>;

// The longest one start of a sandbox stays up, whatever runs in it.
export const LIFETIME_MS = 2 * 60 * 60 * 1000;

export const WORKSPACE = "/workspace";
const USER = "sandbox";
const UID = "1000:1000";
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const BUNDLE = "/etc/ssl/certs/ca-certificates.crt";

// exec() passes no image environment but PATH, so every process gets these.
const PROCESS_ENV = {
  HOME: WORKSPACE,
  LANG: "C.UTF-8",
  SSL_CERT_FILE: BUNDLE,
  REQUESTS_CA_BUNDLE: BUNDLE,
  PIP_CERT: BUNDLE,
  NODE_EXTRA_CA_CERTS: CA,
  PIP_DISABLE_PIP_VERSION_CHECK: "1",
  DEBIAN_FRONTEND: "noninteractive",
};

export const EXEC_SECONDS = { default: 120, max: 600 } as const;
// Characters of each stream an exec returns: the end, where errors are.
export const OUTPUT_CHARS = 32_000;
// Bytes of a file a read returns.
export const READ_BYTES = 256_000;

export type SandboxConfig = {
  organizationId: string;
  agentId: string;
  deploymentId: string;
  caseId: string;
  network: NetworkRules;
  sandbox: SandboxManifest;
};

export type ExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: true;
  truncated?: true;
};

const tail = (text: string) =>
  text.length > OUTPUT_CHARS
    ? { text: text.slice(-OUTPUT_CHARS), cut: true }
    : { text, cut: false };

const decoder = new TextDecoder();

// What every process gets: the platform's variables, then the setup's.
const processEnv = (sandbox: SandboxManifest) => ({
  ...PROCESS_ENV,
  ...sandbox.setup?.env,
});

// exec() needs the instance up, and start() returns before it is.
const execWhenUp = async (
  container: Container,
  cmd: string[],
  options: ContainerExecOptions,
) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await container.exec(cmd, options);
    } catch (error) {
      if (attempt >= 60 || !container.running) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
};

const textStream = (text: string) =>
  new Response(text).body as ReadableStream<Uint8Array>;

export const sandboxName = (c: {
  organizationId: string;
  agentId: string;
  caseId: string;
}) => `${c.organizationId}:${c.agentId}:${c.caseId}`;

type Exports = { Outbound(options: { props: OutboundProps }): Fetcher };

export abstract class CaseSandbox extends DurableObject<Env> {
  protected abstract readonly size: SandboxSize;
  private readonly meter: SandboxMeter;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.meter = new SandboxMeter(ctx, env.PLATFORM);
    // An evicted object that comes back to a running container watches it
    // again; the heartbeat alarm covers a stop nobody saw.
    if (ctx.container?.running) this.watch();
  }

  private container() {
    const container = this.ctx.container;
    if (!container)
      throw new Error(
        "Sandboxes are not available here: this runtime has no container binding.",
      );
    return container;
  }

  private watch() {
    const container = this.container();
    this.ctx.waitUntil(
      container.monitor().then(
        () => this.stopped("sleep"),
        () => this.stopped("crash"),
      ),
    );
  }

  // Set while destroy() runs: destroying the container also settles
  // monitor(), and that stop is the destroy, not a crash. A crash closes the
  // interval at its last heartbeat, so on staging it billed a 7 s sandbox 0 s.
  private destroying = false;

  private async stopped(type: "sleep" | "crash") {
    if (this.destroying) return;
    await this.ctx.storage.delete("sandbox:startedAt");
    const at = new Date();
    const owner = await this.ctx.storage.get<SandboxOwner>("sandbox:open");
    await this.meter.end(type);
    if (owner) this.log(owner, "sandbox.stop", at, type);
  }

  // The container's start and stop as this object saw them, in the case's run
  // log beside the interval the API timed, and how long a custom environment
  // took to mount; the staging smoke test reads both.
  private log(
    owner: SandboxOwner,
    kind: "sandbox.start" | "sandbox.stop" | "sandbox.mount",
    at: Date,
    reason: string,
    fields: {
      mountMs?: number;
      layerBytes?: number;
      mountMode?: string;
      mountLog?: string;
    } = {},
  ) {
    initLogs("runtime", (records) =>
      this.env.PLATFORM ? this.env.PLATFORM.logs(records) : Promise.resolve(),
    );
    const log = wideEvent(
      kind,
      {
        organizationId: owner.organizationId,
        ...(owner.agent && { agentId: owner.agent }),
        ...(owner.caseId && { caseId: owner.caseId }),
      },
      (promise) => this.ctx.waitUntil(promise),
    );
    log.set({
      message:
        kind === "sandbox.start"
          ? `Sandbox ${reason === "wake" ? "woke" : "started"} (${this.size})`
          : kind === "sandbox.stop"
            ? `Sandbox stopped (${reason})`
            : `Custom environment mounted in ${fields.mountMs ?? 0} ms`,
      size: this.size,
      reason,
      containerAt: at.toISOString(),
      ...fields,
    });
    log.emit();
  }

  // Starts or wakes the container when it is not running, and returns what
  // installing the agent's packages printed when that failed.
  private async ensure(config: SandboxConfig): Promise<string | null> {
    if (config.sandbox.size !== this.size)
      throw new Error(
        `a ${config.sandbox.size} sandbox asked a ${this.size} one`,
      );
    const container = this.container();
    if (container.running) return null;
    const image = container.images[SANDBOX_IMAGE[config.sandbox.preset]];
    if (!image)
      throw new Error(`no image for the ${config.sandbox.preset} preset`);
    const layer = config.sandbox.setup
      ? await this.layerFor(config, image)
      : null;
    const outbound = (this.ctx.exports as unknown as Exports).Outbound({
      props: { organizationId: config.organizationId, network: config.network },
    });
    const woken =
      (await this.ctx.storage.get<number>("sandbox:seq")) !== undefined;
    let startedAt = new Date();
    try {
      await container.interceptAllOutboundHttp(outbound);
      await container.interceptOutboundHttps("*", outbound);
      startedAt = new Date();
      container.start({
        image,
        instance: SANDBOX_INSTANCE[this.size],
        enableInternet: false,
        entrypoint: ["sleep", "infinity"],
        labels: {
          org: config.organizationId,
          agent: config.agentId,
          case: config.caseId,
          kind: "sandbox",
          size: this.size,
        },
      });
    } catch (error) {
      if (container.running) await container.destroy();
      throw error;
    }
    // The interval opens as soon as the container is asked to start: setting
    // its timeout waits for it to boot, which staging measured at 3.7 s.
    const owner = {
      organizationId: config.organizationId,
      agent: config.agentId,
      caseId: config.caseId,
    };
    await this.meter.begin(owner, "case", this.size, woken ? "wake" : "start");
    await this.ctx.storage.put("sandbox:startedAt", Date.now());
    this.log(owner, "sandbox.start", startedAt, woken ? "wake" : "start");
    this.watch();
    try {
      await container.setInactivityTimeout(
        config.sandbox.idleTimeoutMinutes * 60_000,
      );
    } catch (error) {
      await this.destroy();
      throw error;
    }
    if (layer) {
      const mounting = Date.now();
      const printed = await this.mount(container, layer);
      this.log(owner, "sandbox.mount", new Date(), "mount", {
        mountMs: Date.now() - mounting,
        layerBytes: layer.bytes,
        mountMode: /^MOUNT=(\w+)$/m.exec(printed)?.[1] ?? "unknown",
        mountLog: tail(printed).text,
      });
    }
    return this.install(container, config.sandbox);
  }

  // The deployment's custom environment for this image: the one its row
  // names, or, when that was built on an older preset image or collected,
  // built now and recorded on the row before the first command runs.
  private async layerFor(config: SandboxConfig, image: string): Promise<Layer> {
    const platform = this.env.PLATFORM;
    if (!platform) throw new Error("custom environments need the platform");
    const deployment: DeploymentRef = {
      organizationId: config.organizationId,
      agentId: config.agentId,
      deploymentId: config.deploymentId,
    };
    const named = await platform.sandboxLayer(deployment);
    if (
      named &&
      named.image === image &&
      ownsLayer(config.organizationId, named.key) &&
      (await this.env.BUNDLES.head(named.key))
    )
      return named;
    const job: LayerJob = {
      organizationId: config.organizationId,
      agentId: config.agentId,
      preset: config.sandbox.preset,
      setup: config.sandbox.setup!,
      network: config.network,
    };
    const result = await this.env.SANDBOX_LARGE.getByName(
      await layerBuilderName(job),
    ).buildLayer(job);
    const recorded = await platform.sandboxLayerBuilt({ deployment, result });
    if ("error" in recorded)
      throw new Error(
        `the custom environment is not available: ${recorded.error}`,
      );
    if ("error" in result) throw new Error(result.error);
    return result;
  }

  // Streams the layer from R2 into mount.sh, which mounts it over the preset;
  // no command runs before it is in place. Returns what mount.sh printed.
  private async mount(container: Container, layer: Layer): Promise<string> {
    const object = await this.env.BUNDLES.get(layer.key);
    if (!object) throw new Error("the custom environment's layer is missing");
    const process = await execWhenUp(
      container,
      ["/opt/preprocess/layer/mount.sh"],
      { stdin: object.body, stderr: "combined" },
    );
    const output = await process.output();
    const printed = decoder.decode(output.stdout);
    if (output.exitCode === 0) return printed;
    await this.destroy();
    throw new Error(
      `the custom environment did not mount: ${tail(printed).text}`,
    );
  }

  // A deploy's build (spec 3): queued here and run on the alarm, which
  // reports the result for every deployment waiting on it.
  async queueLayer(queued: QueuedLayer) {
    const current = await this.ctx.storage.get<QueuedLayer>("layer:queued");
    const waiting = [...(current?.waiting ?? []), ...queued.waiting].filter(
      (d, i, all) =>
        all.findIndex((o) => o.deploymentId === d.deploymentId) === i,
    );
    await this.ctx.storage.put("layer:queued", { job: queued.job, waiting });
    await this.ctx.storage.setAlarm(Date.now());
  }

  private building: Promise<LayerResult> | undefined;

  // Builds the layer for a setup, or finds it already built. Callers at the
  // same time share one build.
  buildLayer(job: LayerJob): Promise<LayerResult> {
    this.building ??= this.runBuild(job).finally(() => {
      this.building = undefined;
    });
    return this.building;
  }

  private async runBuild(job: LayerJob): Promise<LayerResult> {
    const container = this.container();
    const image = container.images[SANDBOX_IMAGE[job.preset]];
    if (!image) return { error: `no image for the ${job.preset} preset` };
    const key = await layerKey(job.organizationId, image, job.setup);
    const found = await this.env.BUNDLES.head(key);
    if (found)
      return {
        key,
        image,
        bytes: found.size,
        unpackedBytes: Number(
          found.customMetadata?.unpackedBytes ?? found.size,
        ),
      };
    if (container.running) await container.destroy();
    const outbound = (this.ctx.exports as unknown as Exports).Outbound({
      props: { organizationId: job.organizationId, network: job.network },
    });
    await container.interceptAllOutboundHttp(outbound);
    await container.interceptOutboundHttps("*", outbound);
    container.start({
      image,
      instance: LAYER_INSTANCE,
      enableInternet: false,
      entrypoint: ["sleep", "infinity"],
      labels: { org: job.organizationId, agent: job.agentId, kind: "layer" },
    });
    await container.setInactivityTimeout(LAYER_BUILD_SECONDS * 1000);
    await this.meter.begin(
      { organizationId: job.organizationId, agent: job.agentId },
      "build",
      LAYER_INSTANCE,
    );
    // The alarm that would heartbeat is busy running this build.
    const heartbeat = setInterval(() => {
      void this.meter.heartbeat(true);
    }, 30_000);
    try {
      const process = await execWhenUp(
        container,
        ["/opt/preprocess/layer/build.sh"],
        {
          stdin: textStream(JSON.stringify(job.setup)),
          stderr: "combined",
          cwd: WORKSPACE,
          env: PROCESS_ENV,
        },
      );
      const timer = setTimeout(
        () => process.kill(9),
        LAYER_BUILD_SECONDS * 1000,
      );
      const output = await process.output().finally(() => clearTimeout(timer));
      const text = decoder.decode(output.stdout);
      const log = text.slice(-LAYER_LOG_CHARS);
      const sizes = parseLayerSizes(text);
      if (output.exitCode !== 0 || !sizes)
        return {
          error:
            output.exitCode === 137
              ? `the setup ran past ${LAYER_BUILD_SECONDS / 60} minutes`
              : "a setup step failed",
          log,
        };
      const cat = await container.exec(["cat", "/.preprocess/layer.sqfs"], {
        stderr: "ignore",
      });
      const { readable, writable } = new FixedLengthStream(sizes.bytes);
      const [, put] = await Promise.all([
        cat.stdout!.pipeTo(writable),
        this.env.BUNDLES.put(key, readable, {
          customMetadata: {
            image,
            unpackedBytes: String(sizes.unpackedBytes),
          },
        }),
      ]);
      if (!put) return { error: "the layer could not be stored", log };
      return { key, image, ...sizes };
    } finally {
      clearInterval(heartbeat);
      if (container.running) await container.destroy();
      await this.meter.end("destroy");
    }
  }

  // Trusts the outbound gateway's certificate, then installs the agent's
  // packages over the preset. Names were checked at deploy and go as argv.
  private async install(container: Container, sandbox: SandboxManifest) {
    const steps: { cmd: string[]; user?: string; cwd?: string }[] = [
      { cmd: ["sh", "-c", `cat ${CA} >> ${BUNDLE}`] },
    ];
    const { apt, pip, npm } = sandbox.packages;
    if (apt.length)
      steps.push(
        { cmd: ["apt-get", "update", "-qq"] },
        {
          cmd: [
            "apt-get",
            "install",
            "-y",
            "-qq",
            "--no-install-recommends",
            ...apt,
          ],
        },
      );
    if (pip.length)
      steps.push({
        cmd: ["pip", "install", "--quiet", "--no-input", ...pip],
        user: USER,
      });
    if (npm.length)
      steps.push({
        cmd: ["npm", "install", "--no-audit", "--no-fund", "--silent", ...npm],
        user: USER,
        cwd: WORKSPACE,
      });
    for (const step of steps) {
      const process = await container.exec(step.cmd, {
        env: processEnv(sandbox),
        stderr: "combined",
        ...(step.user && { user: step.user }),
        ...(step.cwd && { cwd: step.cwd }),
      });
      const output = await process.output();
      if (output.exitCode !== 0)
        return `${step.cmd.join(" ")} exited ${output.exitCode}:\n${tail(decoder.decode(output.stdout)).text}`;
    }
    return null;
  }

  async exec(
    config: SandboxConfig,
    input: { command: string; cwd?: string; timeoutSeconds?: number },
  ): Promise<ExecResult & { installFailed?: string }> {
    const installFailed = await this.ensure(config);
    const container = this.container();
    const seconds = Math.min(
      input.timeoutSeconds ?? EXEC_SECONDS.default,
      EXEC_SECONDS.max,
    );
    const process = await container.exec(["bash", "-lc", input.command], {
      env: processEnv(config.sandbox),
      user: USER,
      cwd: input.cwd ?? WORKSPACE,
    });
    const killed = { timedOut: false };
    const timer = setTimeout(() => {
      killed.timedOut = true;
      process.kill(9);
    }, seconds * 1000);
    try {
      const output = await process.output();
      const { timedOut } = killed;
      const stdout = tail(decoder.decode(output.stdout));
      const stderr = tail(decoder.decode(output.stderr));
      return {
        exitCode: timedOut ? null : output.exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        ...(timedOut && { timedOut: true as const }),
        ...((stdout.cut || stderr.cut) && { truncated: true as const }),
        ...(installFailed !== null && { installFailed }),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async readFile(config: SandboxConfig, path: string) {
    await this.ensure(config);
    const response = await new Files(this.container()).readFile(path, {
      cwd: WORKSPACE,
      user: UID,
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      content: decoder.decode(bytes.slice(0, READ_BYTES)),
      bytes: bytes.byteLength,
      ...(bytes.byteLength > READ_BYTES && { truncated: true as const }),
    };
  }

  async writeFile(config: SandboxConfig, path: string, content: string) {
    await this.ensure(config);
    await new Files(this.container()).writeFile(path, content, {
      cwd: WORKSPACE,
      user: UID,
    });
    return { bytes: new TextEncoder().encode(content).byteLength };
  }

  // The case closed: the container goes, and its interval closes now.
  async destroy() {
    await this.ctx.storage.delete("sandbox:startedAt");
    if (!this.ctx.container?.running) return this.meter.end("crash");
    const owner = await this.ctx.storage.get<SandboxOwner>("sandbox:open");
    this.destroying = true;
    try {
      await this.ctx.container.destroy();
      const at = new Date();
      await this.meter.end("destroy");
      if (owner) this.log(owner, "sandbox.stop", at, "destroy");
    } finally {
      this.destroying = false;
    }
  }

  // Every heartbeat: a container past its lifetime is destroyed; otherwise
  // the meter heartbeats, or closes a container found gone at its last
  // heartbeat.
  override async alarm() {
    const queued = await this.ctx.storage.get<QueuedLayer>("layer:queued");
    if (queued) {
      const result = await this.buildLayer(queued.job).catch(
        (error: unknown): LayerResult => ({ error: String(error) }),
      );
      // Deploys that queued while it ran share the result.
      const waiting =
        (await this.ctx.storage.get<QueuedLayer>("layer:queued"))?.waiting ??
        queued.waiting;
      await this.ctx.storage.delete("layer:queued");
      for (const deployment of waiting)
        await this.env.PLATFORM?.sandboxLayerBuilt({ deployment, result });
      return;
    }
    const startedAt = await this.ctx.storage.get<number>("sandbox:startedAt");
    if (startedAt !== undefined && Date.now() - startedAt >= LIFETIME_MS)
      return this.destroy();
    await this.meter.heartbeat(this.ctx.container?.running ?? false);
  }
}

export class SandboxSmall extends CaseSandbox {
  protected readonly size = "small";
}

export class SandboxMedium extends CaseSandbox {
  protected readonly size = "medium";
}

export class SandboxLarge extends CaseSandbox {
  protected readonly size = "large";
}
