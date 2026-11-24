import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

// An agent whose code names a group to wait on.
export default agent({
  instructions: "You route contracts to legal.",
  groups: ["legal"],
  tools: {
    review: tool({
      description: "Send a contract to legal",
      input: z.object({ contract: z.string() }),
      run: ({ contract }, ctx) => {
        ctx.waitOn("legal", { reason: `Review ${contract}` });
        return Promise.resolve("sent");
      },
    }),
  },
});
