// The GitHub build sandbox (docs/design/08-github-app.md). The API hands it
// a commit's tarball; it installs with the project's own lockfile and
// bundles with the CLI's bundle() in a fresh container per build, and
// returns the bundle and the log. It never receives a credential.
//
// On Cloudflare each build gets its own BuildSandbox Durable Object and
// container. In `pnpm dev` the same image runs under the local Docker
// through apps/builder/local/server.ts (LOCAL_DOCKER_BUILDER).

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

import { parseBuild } from "./result.ts";
import type { BuildRequest, BuildResult } from "./types.ts";

type Env = {
  SANDBOX?: DurableObjectNamespace<BuildSandbox>;
  LOCAL_DOCKER_BUILDER?: string;
};

const decoder = new TextDecoder();

export class BuildSandbox extends DurableObject<Env> {
  async build(request: BuildRequest): Promise<BuildResult> {
    const container = this.ctx.container;
    if (!container) throw new Error("No container is configured");
    if (!container.running)
      container.start({
        ...(container.images.BuildImage && {
          image: container.images.BuildImage,
        }),
        // Installs reach the package registries. Nothing secret is inside.
        enableInternet: true,
      });
    try {
      const process = await this.exec(container, request);
      const output = await process.output();
      return parseBuild(
        output.exitCode,
        decoder.decode(output.stdout) + decoder.decode(output.stderr),
      );
    } finally {
      if (container.running) await container.destroy();
    }
  }

  async cancel() {
    if (this.ctx.container?.running) await this.ctx.container.destroy();
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
