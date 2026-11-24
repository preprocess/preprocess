import rootConfig from "../../eslint.config.mjs";

export default [
  { ignores: [".wrangler/**", "eslint.config.mjs", "test/dist/**"] },
  ...rootConfig,
];
