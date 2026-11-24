import { agent, schema as s, tool } from "@preprocess/sdk";
import { z } from "zod";

// A coded agent with an output schema: the stub model decides the vendor,
// answers the fields, tags and waits on accounts payable, and on a rerun
// disagrees with a person's edit (apps/model-stub/fixtures/chat.json).
export default agent({
  instructions: "You fill in invoice cases for Acme's accounts payable.",
  model: "inkling-2-small",
  groups: ["accounts-payable"],
  schema: s.group(
    {
      vendor: s.select({
        description: "Vendor that issued the invoice",
        options: [
          { id: "acme", label: "Acme Corporation" },
          { id: "globex", label: "Globex", description: "Industrial supplies" },
          { id: "initech", label: "Initech", description: "Software" },
        ],
        review: "required",
      }),
      amount: s.number({ description: "Total due" }),
      currency: s.select({
        description: "Currency of the total",
        options: (a) =>
          a.get("vendor") === "globex" ? ["EUR"] : ["USD", "EUR"],
      }),
      approverNote: s.text({
        description: "Why a large invoice is approved",
        visible: (a) => Number(a.get("amount") ?? 0) > 1000,
      }),
    },
    {
      checks: {
        amountPositive: (a) =>
          Number(a.get("amount") ?? 0) > 0 || {
            field: "amount",
            message: "must be positive",
          },
      },
    },
  ),
  tools: {
    flag_vendor: tool({
      description: "Hand the case to accounts payable to confirm the vendor",
      input: z.object({ reason: z.string() }),
      run: ({ reason }, ctx) => {
        ctx.waitOn("accounts-payable", { reason });
        return "handed to accounts payable";
      },
    }),
  },
});
