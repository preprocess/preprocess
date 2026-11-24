import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

// An agent that reaches the organization's CRM through MCP. Its code never
// holds the CRM token: the platform's token service adds it.
export default agent({
  instructions: "You find contacts in Acme's CRM. Be brief.",
  mcp: ["crm"],
  tools: {
    find_contact: tool({
      description: "Find a contact in the CRM",
      input: z.object({ q: z.string() }),
      run: ({ q }, ctx) => ctx.mcp("crm").call("search_contacts", { q }),
    }),
  },
});
