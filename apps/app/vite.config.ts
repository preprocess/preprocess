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

// Preview mode (PREPROCESS_PREVIEW=true, `pnpm dev:preview`) swaps WorkOS
// AuthKit for the preview sign-in in src/preview and serves seeded scenarios
// (apps/app/README.md, Preview mode). It exists only under `vite dev`: any build with it set
// fails here, so no deployable Worker can carry it.
export default defineConfig(({ command }) => {
  const preview = process.env.PREPROCESS_PREVIEW === "true";
  if (preview && command !== "serve") {
    throw new Error(
      "PREPROCESS_PREVIEW=true is for `vite dev` only; builds never include the preview sign-in.",
    );
  }

  return {
    define: {
      __PREPROCESS_SHARED_UI_BUNDLE_PROBE__: JSON.stringify(
        process.env.VITE_PREPROCESS_SHARED_UI_BUNDLE_PROBE === "true",
      ),
      __PREPROCESS_PREVIEW__: JSON.stringify(preview),
    },
    resolve: {
      alias: [
        ...(preview
          ? [
              {
                find: /^@workos\/authkit-tanstack-react-start$/,
                replacement: path.join(appRoot, "src/preview/authkit.ts"),
              },
              {
                find: /^@workos\/authkit-tanstack-react-start\/client$/,
                replacement: path.join(
                  appRoot,
                  "src/preview/authkit-client.tsx",
                ),
              },
            ]
          : []),
        { find: "@", replacement: path.join(appRoot, "src") },
      ],
      dedupe: ["react", "react-dom"],
    },
    // Capy previews reach the dev server through a proxy host.
    server: preview ? { allowedHosts: true } : undefined,
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
    // Do not prebundle AuthKit into Vite's SSR deps cache. optimizeDeps skips the
    // TanStack `?tss-serverfn-split` transform, so client RPCs like
    // `checkSessionAction` arrive with Invalid server function ID and blank the
    // app. Eager-import the actions from `src/start.ts` instead so they register
    // at boot (avoids mid-request discovery rewrites).
    //
    // Keep `@workos-inc/node` prebundled — it has no Start server fns.
    //
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
          include: ["@workos-inc/node", ...uiCommonJs],
          exclude: [
            "@preprocess/ui",
            "@workos/authkit-tanstack-react-start",
            "@workos/authkit-tanstack-react-start/client",
          ],
        },
      },
    },
  };
});
