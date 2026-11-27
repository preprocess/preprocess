import { agent } from "@preprocess/sdk";

// An agent whose code asks for a medium Python sandbox.
export default agent({
  instructions: "You run quick calculations in your sandbox.",
  sandbox: { size: "medium", preset: "python" },
  tools: {},
});
