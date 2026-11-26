// The agent the staging smoke test's sandbox step deploys: a small sandbox
// and no other tools, so against the stub model service it runs one command
// there and completes. Bundled by scripts/smoke.ts with SMOKE=sandbox.

import { agent } from "@preprocess/sdk";

export default agent({
  instructions:
    "You confirm that a deployment's sandbox works. Run what you are asked to, then reply in one sentence.",
  sandbox: { size: "small" },
  tools: {},
});
