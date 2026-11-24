# @preprocess/sdk

The TypeScript SDK agents are written with (spec 3). An agent is a Worker that
Preprocess deploys into the organization's dispatch namespace. The runtime (Pi
Durable, in the platform's Durable Objects) runs the model loop and calls the
agent's Worker for its manifest and for each tool call.

```ts
import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

export default agent({
  instructions: "You answer stock questions for Acme.",
  model: "inkling-2-small",
  secrets: ["ERP_TOKEN"],
  mcp: ["crm"],
  tools: {
    lookup_stock: tool({
      description: "Look up stock for a SKU",
      input: z.object({ sku: z.string() }),
      run: async ({ sku }, { env }) => {
        const response = await fetch(`https://erp.example.com/stock/${sku}`, {
          headers: { authorization: `Bearer ${env.ERP_TOKEN}` },
        });
        return response.json();
      },
    }),
    find_contact: tool({
      description: "Find a CRM contact",
      input: z.object({ q: z.string() }),
      run: ({ q }, ctx) => ctx.mcp("crm").call("search_contacts", { q }),
    }),
  },
});
```

- **Secrets.** `secrets` lists the organization secrets the code needs. Only
  those an Admin granted to the agent are bound; the rest are `undefined`.
  Values reach only this Worker, never the model, the case thread, logs or run
  capture. The SDK removes bound values from tool results, errors and console
  output as a second line of defence; code that transforms a value can still
  leak it.
- **MCP.** `mcp` lists the servers the agent uses. Calls go through the
  platform's token service, which adds the organization's connection token; the
  code never holds it.
- **Protocol.** `@preprocess/sdk/protocol` holds the manifest and tool-call
  types the runtime speaks (`GET /manifest`, `POST /tools/:name`). Each
  deployment records the SDK version it was built with.

Unlike the rest of this repository, which is under the Elastic License 2.0,
everything in this directory is MIT licensed (see LICENSE).
