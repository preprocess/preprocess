import { applyMdxPreset } from "fumadocs-mdx/config";
import { defineDocs } from "fumadocs-mdx/macro";

import { monochrome } from "./shiki-theme";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    async: true,
    postprocess: { includeProcessedMarkdown: true },
    mdxOptions: applyMdxPreset({
      rehypeCodeOptions: { themes: { light: monochrome, dark: monochrome } },
    }),
  },
});
