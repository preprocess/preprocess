import rootConfig from "../../eslint.config.mjs";

export default [
  // image/ runs inside the build container, against the CLI copied there.
  { ignores: [".wrangler/**", "eslint.config.mjs", "image/**"] },
  ...rootConfig,
];
