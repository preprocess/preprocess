import { WorkerEntrypoint } from "cloudflare:workers";

// Stands in for the API's MCP token service: answers with what it was asked,
// so tests can see the props the capability carried.
export class McpService extends WorkerEntrypoint {
  listTools() {
    return [];
  }

  call(props: unknown, server: string, tool: string, args: unknown) {
    return { props, server, tool, args };
  }
}

export default {
  fetch: () => new Response("mcp service"),
};
