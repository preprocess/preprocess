import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

// An agent that declares the host its code calls.
export default agent({
  instructions: "You fetch exchange rates from the bank.",
  network: ["rates.bank.test"],
  tools: {
    rate: tool({
      description: "Today's rate for a currency",
      input: z.object({ currency: z.string() }),
      run: async ({ currency }) =>
        (await fetch(`https://rates.bank.test/${currency}`)).json(),
    }),
  },
});
