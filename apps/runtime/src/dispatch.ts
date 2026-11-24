import type { Deployment, Env } from "./env.ts";

const SCRIPT_HEADER = "x-preprocess-script";
const OUTBOUND_HEADER = "x-preprocess-outbound";

// The agent's deployed Worker, reached statelessly through the dispatch
// namespace. Every fetch() the agent's code makes passes the outbound Worker
// with this organization's network rules.
export const agentWorker = (
  env: Env,
  deployment: Deployment,
): { fetch(path: string, init?: RequestInit): Promise<Response> } => {
  const outbound = {
    organizationId: deployment.organizationId,
    network: JSON.stringify(deployment.network),
  };
  if (env.DISPATCHER) {
    const worker = env.DISPATCHER.get(deployment.script, {}, { outbound });
    return {
      fetch: (path, init) => worker.fetch(`https://agent${path}`, init),
    };
  }
  const local = env.LOCAL_NAMESPACE;
  if (!local) throw new Error("no dispatch namespace binding");
  return {
    fetch: (path, init) => {
      const request = new Request(`https://agent${path}`, init);
      request.headers.set(SCRIPT_HEADER, deployment.script);
      request.headers.set(OUTBOUND_HEADER, JSON.stringify(outbound));
      return local.fetch(request);
    },
  };
};
