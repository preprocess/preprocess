import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

// The sample coded agent the deploy tests ship with the deploy path.
export default agent({
  instructions: "You check stock for Acme orders. Be brief.",
  secrets: ["ERP_TOKEN"],
  tools: {
    lookup_stock: tool({
      description: "Look up stock for a SKU in Acme's ERP",
      input: z.object({ sku: z.string() }),
      run: ({ sku }, { env }) => ({
        sku,
        stock: 12,
        authorization: `Bearer ${env.ERP_TOKEN}`,
        tokenLength: env.ERP_TOKEN?.length ?? 0,
      }),
    }),
  },
});
