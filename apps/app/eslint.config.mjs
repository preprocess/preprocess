import rootConfig from "../../eslint.config.mjs";

export default [
  {
    ignores: [
      ".output/**",
      ".tanstack/**",
      ".wrangler/**",
      "coverage/**",
      "dist/**",
      "eslint.config.mjs",
      "src/routeTree.gen.ts",
      // Vendored Agent Elements registry copy — keep upstream shape for lab use.
      "src/components/agent-elements/**",
      // Vendored WorkOS widgets client (generated; re-vendor to update).
      "src/features/workos-client-api/vendor/**",
    ],
  },
  ...rootConfig,
  {
    rules: {
      // TanStack Router `redirect()` and `notFound()` return values loaders throw.
      "@typescript-eslint/only-throw-error": [
        "error",
        {
          allow: [
            {
              from: "package",
              package: "@tanstack/router-core",
              name: "Redirect",
            },
            {
              from: "package",
              package: "@tanstack/react-router",
              name: "Redirect",
            },
            {
              from: "package",
              package: "@tanstack/router-core",
              name: "NotFoundError",
            },
          ],
        },
      ],
    },
  },
];
