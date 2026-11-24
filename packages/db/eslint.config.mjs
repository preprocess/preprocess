import rootConfig from "../../eslint.config.mjs";

export default [
  { ignores: [".wrangler/**", "eslint.config.mjs", "drizzle.config.ts"] },
  ...rootConfig,
];
