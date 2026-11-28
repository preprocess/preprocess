import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

// @preprocess/ui ships TypeScript source, so Vite compiles it like our own
// code and prebundles the CommonJS modules it reaches through Base UI, as the
// app does.
const uiCommonJs = [
  "@preprocess/ui > @base-ui/react > use-sync-external-store/shim",
  "@preprocess/ui > @base-ui/react > @base-ui/utils > use-sync-external-store/shim",
  "@preprocess/ui > @base-ui/react > @base-ui/utils > use-sync-external-store/shim/with-selector",
];

export default defineConfig({
  resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom"] },
  plugins: [
    fumadocsMdx(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({ router: { quoteStyle: "double", semicolons: true } }),
    viteReact(),
    tailwindcss(),
  ],
  optimizeDeps: { include: uiCommonJs, exclude: ["@preprocess/ui"] },
  environments: {
    ssr: { optimizeDeps: { include: uiCommonJs, exclude: ["@preprocess/ui"] } },
  },
});
