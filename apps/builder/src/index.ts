// The GitHub build sandbox (docs/design/08-github-app.md). The API hands it
// a commit's tarball; it installs with the project's own lockfile and
// bundles with the CLI's bundle() in a fresh container per build, and
// returns the bundle and the log. It never receives a credential.
//
// On Cloudflare each build gets its own BuildSandbox Durable Object and
// container. In `pnpm dev` the same image runs under the local Docker
// through apps/builder/local/server.ts (LOCAL_DOCKER_BUILDER).

import { SandboxMeter, type SandboxReporter } from "@preprocess/sandbox";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

import { parseBuild } from "./result.ts";
import type { BuildRequest, BuildResult } from "./types.ts";

type Env = {
  SANDBOX?: DurableObjectNamespace<BuildSandbox>;
  LOCAL_DOCKER_BUILDER?: string;
  // The API, which times the container's awake interval (spec 16a).
  PLATFORM?: SandboxReporter;
};

const decoder = new TextDecoder();

// basic: 1/4 vCPU, 1 GiB, 4 GB disk. On lite (256 MiB) an install hits the
// memory cap and runs four times slower for the same cost. A build lasts at
// most its timeout (build.sh), and the API stops waiting 30 seconds after
// that; if this Durable Object goes away first, the container stops a minute
// later.
const SIZE = "basic";
const INACTIVITY_TIMEOUT_MS = 60_000;

export class BuildSandbox extends DurableObject<Env> {
  private readonly meter = new SandboxMeter(this.ctx, this.env.PLATFORM);

  async build(request: BuildRequest): Promise<BuildResult> {
    const container = this.ctx.container;
    if (!container) throw new Error("No container is configured");
    if (!container.running) {
      container.start({
        ...(container.images.BuildImage && {
          image: container.images.BuildImage,
        }),
        // Installs reach the package registries. Nothing secret is inside.
        enableInternet: true,
        instance: SIZE,
      });
      await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
      await this.meter.begin(request.owner, "build", SIZE);
    }
    try {
      const process = await this.exec(container, request);
      const output = await process.output();
      return parseBuild(
        output.exitCode,
        decoder.decode(output.stdout) + decoder.decode(output.stderr),
      );
    } finally {
      await this.stop();
    }
  }

  async cancel() {
    await this.stop();
  }

  override async alarm() {
    await this.meter.check(this.ctx.container?.running ?? false);
  }

  // A container already gone was not destroyed by us: it crashed.
  private async stop() {
    const container = this.ctx.container;
    if (!container?.running) return this.meter.end("crash");
    await container.destroy();
    await this.meter.end("destroy");
  }

  // exec() needs the instance up, and start() returns before it is.
  private async exec(container: Container, request: BuildRequest) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await container.exec(["/opt/preprocess/build.sh"], {
          stdin: request.archive,
          env: {
            DIRECTORY: request.directory || ".",
            ENTRY: request.entry,
            TIMEOUT: String(request.timeoutSeconds),
          },
        });
      } catch (error) {
        if (attempt >= 60 || !container.running) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
}

export class Builder extends WorkerEntrypoint<Env> {
  async build(request: BuildRequest): Promise<BuildResult> {
    const local = this.env.LOCAL_DOCKER_BUILDER;
    if (!local) return this.sandbox(request.id).build(request);
    const url = new URL("/build", local);
    url.searchParams.set("id", request.id);
    url.searchParams.set("directory", request.directory || ".");
    url.searchParams.set("entry", request.entry);
    url.searchParams.set("timeout", String(request.timeoutSeconds));
    const response = await fetch(url, {
      method: "POST",
      body: request.archive,
    });
    if (!response.ok) return { status: "failed", log: await response.text() };
    const { exitCode, output } = await response.json<{
      exitCode: number;
      output: string;
    }>();
    return parseBuild(exitCode, output);
  }

  async cancel(id: string) {
    const local = this.env.LOCAL_DOCKER_BUILDER;
    if (!local) return this.sandbox(id).cancel();
    await fetch(new URL(`/build/${encodeURIComponent(id)}`, local), {
      method: "DELETE",
    });
  }

  private sandbox(id: string) {
    if (!this.env.SANDBOX) throw new Error("No build sandbox is bound");
    return this.env.SANDBOX.getByName(id);
  }
}

export default {
  fetch: () => new Response("preprocess builder", { status: 404 }),
} satisfies ExportedHandler<Env>;
