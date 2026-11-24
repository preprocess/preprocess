import { WorkerEntrypoint } from "cloudflare:workers";

import type { Env, McpProps } from "./env.ts";

// The `MCP` capability agent code receives with each dispatch (design doc
// 03). Its props, which the agent's code cannot read or change, fix the
// organization, agent and deployment; the API's token service adds the
// organization's token. The model loop never sees it.
export class McpBroker extends WorkerEntrypoint<Env, McpProps> {
  private service() {
    if (!this.env.MCP_SERVICE)
      throw new Error("MCP servers are not available in this stage");
    return this.env.MCP_SERVICE;
  }

  listTools(server: string) {
    return this.service().listTools(this.ctx.props, server);
  }

  call(
    server: string,
    tool: string,
    args: unknown,
    _opts?: { caseId: string },
  ) {
    return this.service().call(this.ctx.props, server, tool, args);
  }
}
