import { WorkerEntrypoint } from "cloudflare:workers";

import type { Env, McpProps } from "./env.ts";

// The `MCP` capability agent code receives with each dispatch (design doc
// 03). Its props, which the agent's code cannot read or change, fix the
// organization, agent, deployment and case; the API's token service adds the
// organization's token. The model loop never sees it. Each call made for a
// case is counted in that case's run, off the call's path.
export class McpBroker extends WorkerEntrypoint<Env, McpProps> {
  private service() {
    if (!this.env.MCP_SERVICE)
      throw new Error("MCP servers are not available in this stage");
    return this.env.MCP_SERVICE;
  }

  private target() {
    const { caseId: _, ...target } = this.ctx.props;
    return target;
  }

  listTools(server: string) {
    return this.service().listTools(this.target(), server);
  }

  async call(
    server: string,
    tool: string,
    args: unknown,
    _opts?: { caseId: string },
  ) {
    let failed = true;
    try {
      const result = await this.service().call(
        this.target(),
        server,
        tool,
        args,
      );
      failed = (result as { isError?: unknown } | null)?.isError === true;
      return result;
    } finally {
      const { organizationId, agentId, caseId } = this.ctx.props;
      if (caseId)
        this.ctx.waitUntil(
          this.env.CASE_RUNTIME.getByName(
            `${organizationId}:${agentId}:${caseId}`,
          )
            .mcpCalled(server, failed)
            .catch(() => undefined),
        );
    }
  }
}
