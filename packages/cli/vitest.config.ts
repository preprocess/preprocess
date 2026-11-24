import { defineConfig } from "vitest/config";

// The CLI runs in Node, so its tests do too.
export default defineConfig({ test: { environment: "node" } });
