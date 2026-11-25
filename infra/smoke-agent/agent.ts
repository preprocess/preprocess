// The agent the staging smoke test deploys and runs: no tools and no
// secrets, so against the stub model service it answers once and completes.
// Bundled by scripts/smoke.ts the way `preprocess deploy` bundles an agent.

import { agent } from "@preprocess/sdk";

export default agent({
  instructions: "You confirm that a deployment works. Reply in one sentence.",
  tools: {},
});
