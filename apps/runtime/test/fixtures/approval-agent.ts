import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

const worker = agent({
  instructions: "You check stock for Acme orders. Be brief.",
  model: "inkling-2-small",
  tools: {
    lookup_stock: tool({
      description: "Look up stock for a SKU in Acme's ERP",
      input: z.object({ sku: z.string() }),
      run: ({ sku }) => ({ sku, stock: 12 }),
    }),
  },
});

// Any operator approves each lookup and the case's completion. Until the SDK
// declares approvals, the fixture answers as the SDK will: the manifest's
// approvals block, and an approval effect instead of running an unapproved
// call.
export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const path = new URL(request.url).pathname;
    if (path === "/tools/lookup_stock") {
      const call = await request.clone().json<{ approved?: true }>();
      if (!call.approved)
        return Response.json({
          output: null,
          isError: false,
          effects: [
            {
              type: "approval",
              group: null,
              reason: "Stock lookups cost money",
            },
          ],
        });
    }
    const response = await worker.fetch(request, env as never, ctx as never);
    if (path !== "/manifest") return response;
    return Response.json({
      ...(await response.json<Record<string, unknown>>()),
      approvals: {
        groups: [],
        agent: { group: null, conditional: false },
        fields: [],
        tools: [{ name: "lookup_stock", group: null, conditional: false }],
      },
    });
  },
};
