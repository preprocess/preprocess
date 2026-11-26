// The agent the staging smoke test's custom-environment step deploys: a small
// sandbox whose setup installs one apt package and writes one file, so each
// staging deploy builds a layer, stores it in R2 and mounts it in a real
// container. The file names the workflow run, so every run builds a fresh
// layer instead of finding the last one. Bundled by scripts/smoke.ts with
// SMOKE=layer, which defines __SMOKE_RUN__.

import { agent } from "@preprocess/sdk";

declare const __SMOKE_RUN__: string;

export default agent({
  instructions:
    "You confirm that a deployment's custom sandbox environment works. Run exactly the command you are given, once, and reply with only its output, verbatim.",
  sandbox: {
    size: "small",
    setup: {
      packages: { apt: ["tree"] },
      files: {
        "/opt/smoke/layer.txt": `layer file present (run ${__SMOKE_RUN__})`,
      },
    },
  },
  tools: {},
});
