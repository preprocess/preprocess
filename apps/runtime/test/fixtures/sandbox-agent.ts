import { agent } from "@preprocess/sdk";

// An agent with a small Python sandbox and no tools of its own.
export default agent({
  instructions: "You run quick calculations in your sandbox.",
  sandbox: { size: "small", preset: "python" },
  tools: {},
});
