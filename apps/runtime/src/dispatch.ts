import type { Deployment, Env } from "./env.ts";

type Exports = {
  McpBroker(options: {
    props: Pick<Deployment, "organizationId" | "agentId" | "deploymentId">;
  }): Fetcher;
};

// The agent's deployed Worker, reached statelessly through the dispatch
// namespace. Every fetch() the agent's code makes passes the outbound Worker
// with this organization's network rules. With `exports`, the call also
// carries the MCP capability for this deployment as the `MCP` prop.
export const agentWorker = (
  env: Env,
  deployment: Deployment & { caseId?: string },
  exports?: unknown,
): { fetch(path: string, init?: RequestInit): Promise<Response> } => {
  // Who this call serves, for the Tail Worker's run-log records (apps/tail).
  const scoped = (init?: RequestInit): RequestInit => {
    const headers = new Headers(init?.headers);
    headers.set("x-preprocess-org", deployment.organizationId);
    headers.set("x-preprocess-agent", deployment.agentId);
    headers.set("x-preprocess-deployment", deployment.deploymentId);
    if (deployment.caseId) headers.set("x-preprocess-case", deployment.caseId);
    return { ...init, headers };
  };
  const outbound = {
    organizationId: deployment.organizationId,
    network: JSON.stringify(deployment.network),
  };
  const props = exports
    ? {
        MCP: (exports as Exports).McpBroker({
          props: {
            organizationId: deployment.organizationId,
            agentId: deployment.agentId,
            deploymentId: deployment.deploymentId,
          },
        }),
      }
    : {};
  if (env.DISPATCHER) {
    const worker = env.DISPATCHER.get(
      deployment.script,
      { props },
      { outbound },
    );
    return {
      fetch: (path, init) => worker.fetch(`https://agent${path}`, scoped(init)),
    };
  }
  const local = env.LOCAL_NAMESPACE;
  if (!local) throw new Error("no dispatch namespace binding");
  return {
    fetch: (path, init) =>
      local.dispatch(
        deployment.script,
        outbound,
        props,
        new Request(`https://agent${path}`, scoped(init)),
      ),
  };
};
