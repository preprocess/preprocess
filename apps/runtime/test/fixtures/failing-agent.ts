import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

// An agent whose tools fail, for the run limits: lookup_stock is safe to
// retry and carrier_status has side effects. On case_slow, lookup_stock
// outlasts any timeout instead.
export default agent({
  instructions: "You check stock for Acme orders. Be brief.",
  model: "deepseek-v4.1-flash",
  tools: {
    lookup_stock: tool({
      description: "Look up stock for a SKU in Acme's ERP",
      input: z.object({ sku: z.string() }),
      run: async (_input, ctx) => {
        if (ctx.case.id === "case_slow")
          await new Promise((resolve) => setTimeout(resolve, 20_000));
        throw new Error("ERP unavailable");
      },
    }),
    carrier_status: tool({
      description: "Fetch a carrier tracking page",
      input: z.object({ url: z.string() }),
      sideEffects: true,
      run: () => {
        throw new Error("carrier unavailable");
      },
    }),
  },
});
