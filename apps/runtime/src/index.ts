import { WorkerEntrypoint } from "cloudflare:workers";

import type { CaseView } from "./case-runtime.ts";
import type { Deployment, Env, StartCase } from "./env.ts";

export { CaseRuntime } from "./case-runtime.ts";

// Capture events carry arbitrary JSON, which RPC's types cannot express, so
// the stub is typed by the object's own methods.
const runtimeFor = (
  env: Env,
  c: Pick<Deployment, "organizationId" | "agentId"> & { caseId: string },
) =>
  env.CASE_RUNTIME.getByName(
    `${c.organizationId}:${c.agentId}:${c.caseId}`,
  ) as unknown as {
    start(start: StartCase): Promise<CaseView>;
    view(): Promise<CaseView>;
  };

// The runtime's RPC surface for the platform's other Workers. Cases (step 3)
// start through here once the API has resolved the deployment.
export default class Runtime extends WorkerEntrypoint<Env> {
  startCase(start: StartCase) {
    return runtimeFor(this.env, start).start(start);
  }

  getCase(c: { organizationId: string; agentId: string; caseId: string }) {
    return runtimeFor(this.env, c).view();
  }

  // Local development only, until the cases API lands in step 3: start and
  // read a case by HTTP so a deployed agent can be run end to end.
  override async fetch(request: Request) {
    if (this.env.STAGE !== "development")
      return new Response("not found", { status: 404 });
    const url = new URL(request.url);
    const [, dev, org, agent, caseId] = url.pathname.split("/");
    if (dev !== "dev" || !org || !agent || !caseId)
      return new Response("not found", { status: 404 });
    if (request.method === "POST") {
      const body =
        await request.json<
          Omit<StartCase, "organizationId" | "agentId" | "caseId">
        >();
      return Response.json(
        await this.startCase({
          ...body,
          organizationId: org,
          agentId: agent,
          caseId,
        }),
        { status: 202 },
      );
    }
    return Response.json(
      await this.getCase({ organizationId: org, agentId: agent, caseId }),
    );
  }
}
