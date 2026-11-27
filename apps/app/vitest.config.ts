import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Unit tests of the app's own logic, such as the notice stack's builder, in
// the Workers runtime the app deploys to. The app's Worker entry is built by
// Vite, so the tests run without it.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-07-26",
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
});
