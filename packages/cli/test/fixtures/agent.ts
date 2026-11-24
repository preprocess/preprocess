import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

export default agent({
  instructions: "You check stock. Be brief.",
  secrets: ["ERP_TOKEN"],
  tools: {
    lookup_stock: tool({
      description: "Look up stock for a SKU",
      input: z.object({ sku: z.string() }),
      run: ({ sku }) => ({ sku, stock: 12 }),
    }),
  },
});
