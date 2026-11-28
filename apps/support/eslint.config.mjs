import rootConfig from "../../eslint.config.mjs";

export default [
  {
    ignores: [
      ".source/**",
      ".tanstack/**",
      ".wrangler/**",
      "dist/**",
      "eslint.config.mjs",
      "src/routeTree.gen.ts",
    ],
  },
  ...rootConfig,
  {
    rules: {
      // TanStack Router `notFound()` returns a value loaders throw.
      "@typescript-eslint/only-throw-error": [
        "error",
        {
          allow: [
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
