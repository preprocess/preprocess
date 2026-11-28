import { applyMdxPreset } from "fumadocs-mdx/config";
import { defineDocs } from "fumadocs-mdx/macro";

import { monochrome } from "./shiki-theme";

// The help articles: plain Markdown in content/articles/<category>/, built
// into the bundle, so a deploy publishes them.
export const articles = defineDocs({
  dir: "content/articles",
  docs: {
    async: true,
    mdxOptions: applyMdxPreset({
      rehypeCodeOptions: { themes: { light: monochrome, dark: monochrome } },
    }),
  },
});
