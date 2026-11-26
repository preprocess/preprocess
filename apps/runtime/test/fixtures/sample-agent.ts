import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

// The sample coded agent the end-to-end tests deploy: one tool reads a
// secret, one fetches through the network rules, one uses an MCP server.
export default agent({
  instructions: "You check stock for Acme orders. Be brief.",
  model: "deepseek-v4.1-flash",
  secrets: ["ERP_TOKEN"],
  tools: {
    lookup_stock: tool({
      description: "Look up stock for a SKU in Acme's ERP",
      input: z.object({ sku: z.string() }),
      run: ({ sku }, { env }) => ({
        sku,
        stock: 12,
        // A careless tool that echoes its credential; the SDK redacts it.
        authorization: `Bearer ${env.ERP_TOKEN}`,
        tokenLength: env.ERP_TOKEN?.length ?? 0,
      }),
    }),
    carrier_status: tool({
      description: "Fetch a carrier tracking page",
      input: z.object({ url: z.string() }),
      run: async ({ url }) => {
        const response = await fetch(url);
        return {
          status: response.status,
          body: (await response.text()).slice(0, 120),
        };
      },
    }),
  },
});
