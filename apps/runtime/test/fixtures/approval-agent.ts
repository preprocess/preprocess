import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

// Any operator approves each lookup and the case's completion.
export default agent({
  instructions: "You check stock for Acme orders. Be brief.",
  model: "inkling-2-small",
  approval: true,
  tools: {
    lookup_stock: tool({
      description: "Look up stock for a SKU in Acme's ERP",
      input: z.object({ sku: z.string() }),
      approval: true,
      run: ({ sku }) => ({ sku, stock: 12 }),
    }),
  },
});
