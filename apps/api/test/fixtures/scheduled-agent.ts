import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

// An agent with one production-only schedule and one that runs on previews.
export default agent({
  instructions: "You reconcile invoices.",
  schedules: [
    {
      name: "nightly-reconcile",
      cron: "0 2 * * *",
      timezone: "America/New_York",
      text: "Reconcile all open invoices",
    },
    {
      name: "hourly-check",
      cron: "0 * * * *",
      text: "Check for new invoices",
      previews: true,
    },
  ],
  tools: {
    noop: tool({
      description: "Does nothing",
      input: z.object({}),
      run: () => Promise.resolve("ok"),
    }),
  },
});
