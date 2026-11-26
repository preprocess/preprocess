import { agent } from "@preprocess/sdk";

// An agent whose small Python sandbox has a custom environment.
export default agent({
  instructions: "You parse exports with a pinned client.",
  sandbox: {
    size: "small",
    preset: "python",
    setup: {
      packages: { pip: ["requests==2.32.3"] },
      run: ["python3 -c 'import requests'"],
      files: { "config.json": "{}" },
      env: { APP_MODE: "test" },
    },
  },
  tools: {},
});
