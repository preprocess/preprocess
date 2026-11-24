import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

const worker = agent({
  instructions: "You pay approved invoices.",
  groups: ["legal", "finance"],
  tools: {
    pay: tool({
      description: "Pay an invoice",
      input: z.object({ invoice: z.string() }),
      sideEffects: true,
      run: ({ invoice }) => `paid ${invoice}`,
    }),
  },
});

// Finance approves every payment. Until the SDK declares approvals, the
// fixture adds them to the manifest as the SDK will write them.
export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const response = await worker.fetch(request, env as never, ctx as never);
    if (new URL(request.url).pathname !== "/manifest") return response;
    return Response.json({
      ...(await response.json<Record<string, unknown>>()),
      approvals: {
        groups: ["finance"],
        agent: null,
        fields: [],
        tools: [{ name: "pay", group: "finance", conditional: false }],
      },
    });
  },
};
