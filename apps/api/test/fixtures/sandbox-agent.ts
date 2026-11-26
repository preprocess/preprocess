import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

// An agent that asks for a large Python sandbox.
export default agent({
  instructions: "You reconcile spreadsheets with Python.",
  sandbox: {
    size: "large",
    preset: "python-data",
    packages: { pip: ["pdfplumber==0.11.4"] },
  },
  tools: {
    noop: tool({
      description: "Does nothing",
      input: z.object({}),
      run: () => "ok",
    }),
  },
});
