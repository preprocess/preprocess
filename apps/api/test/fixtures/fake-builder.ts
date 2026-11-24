// The build sandbox in API tests. The tarball the fake GitHub serves is the
// commit's name, which picks a behaviour: "fail…" fails, "slow…" takes a
// second and a half, "late…" hits the sandbox's own time limit, anything else
// returns the sample agent's bundle. GET / lists what it was asked.

import { WorkerEntrypoint } from "cloudflare:workers";

type Request = {
  id: string;
  archive: ReadableStream<Uint8Array>;
  directory: string;
  entry: string;
  timeoutSeconds: number;
};

const calls: Record<string, unknown>[] = [];
const cancelled: string[] = [];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Builder extends WorkerEntrypoint<{ SAMPLE_AGENT: string }> {
  async build({ archive, ...request }: Request) {
    const commit = await new Response(archive).text();
    calls.push({ ...request, archive: commit });
    const log = `$ npm ci --no-audit --no-fund\nadded 3 packages\n$ preprocess bundle ${request.entry}\n`;
    if (commit.startsWith("fail"))
      return {
        status: "failed",
        log: `${log}error: Cannot find module './missing'\n`,
      };
    if (commit.startsWith("late")) {
      await wait(request.timeoutSeconds * 1000);
      return { status: "timed_out", log };
    }
    if (commit.startsWith("slow")) await wait(1500);
    return {
      status: "succeeded",
      log,
      bundle: {
        mainModule: "agent.js",
        modules: { "agent.js": this.env.SAMPLE_AGENT },
      },
    };
  }

  cancel(id: string) {
    cancelled.push(id);
  }

  override fetch() {
    return Response.json({ calls, cancelled });
  }
}

export default { fetch: () => new Response(null, { status: 404 }) };
