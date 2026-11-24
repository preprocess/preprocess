import { WorkerEntrypoint } from "cloudflare:workers";

import type { CaseView } from "./case-runtime.ts";
import { agentWorker } from "./dispatch.ts";
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

  // The deployed Worker's manifest, read through the same dispatch path a
  // case uses. The deploy path calls this to learn what the code declares.
  async manifest(deployment: Deployment): Promise<unknown> {
    const response = await agentWorker(this.env, deployment).fetch("/manifest");
    if (!response.ok)
      throw new Error(
        `agent Worker ${deployment.script} answered ${response.status}`,
      );
    return response.json();
  }
}
