import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const uiCommonJs = [
  "@preprocess/ui > @base-ui/react > use-sync-external-store/shim",
  "@preprocess/ui > @base-ui/react > @base-ui/utils > use-sync-external-store/shim",
  "@preprocess/ui > @base-ui/react > @base-ui/utils > use-sync-external-store/shim/with-selector",
];

export default defineConfig(() => {
  return {
    define: {
      __PREPROCESS_SHARED_UI_BUNDLE_PROBE__: JSON.stringify(
        process.env.VITE_PREPROCESS_SHARED_UI_BUNDLE_PROBE === "true",
      ),
    },
    resolve: {
      alias: [{ find: "@", replacement: path.join(appRoot, "src") }],
      dedupe: ["react", "react-dom"],
    },
    plugins: [
      cloudflare({ viteEnvironment: { name: "ssr" } }),
      tanstackStart({
        router: {
          quoteStyle: "double",
          semicolons: true,
        },
      }),
      viteReact(),
      tailwindcss(),
    ],
    // @preprocess/ui ships TypeScript source, so Vite compiles it like the
    // app's own code rather than prebundling it, and prebundles the CommonJS
    // module its components reach through Base UI.
    optimizeDeps: {
      include: uiCommonJs,
      exclude: ["@preprocess/ui"],
    },
    environments: {
      ssr: {
        optimizeDeps: {
          include: uiCommonJs,
          exclude: ["@preprocess/ui"],
        },
      },
    },
  };
});
