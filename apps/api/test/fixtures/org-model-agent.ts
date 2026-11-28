import { agent } from "@preprocess/sdk";

// An agent that runs on an organization model (design doc 10).
export default agent({
  instructions: "You read invoices.",
  model: "org:invoices-v2",
  tools: {},
});
