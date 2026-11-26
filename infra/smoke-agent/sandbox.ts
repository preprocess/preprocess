// The agent the staging smoke test's sandbox step deploys: a small sandbox
// and no other tools, so it runs the one command the case names there and
// completes. Bundled by scripts/smoke.ts with SMOKE=sandbox.

import { agent } from "@preprocess/sdk";

export default agent({
  instructions:
    "You confirm that a deployment's sandbox works. Run exactly the command you are given, once, and reply with only its output, verbatim.",
  sandbox: { size: "small" },
  tools: {},
});
