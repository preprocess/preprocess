import { defineConfig } from "vitest/config";

// The stack runs in Node at deploy time, so its tests do too.
export default defineConfig({ test: { environment: "node" } });
