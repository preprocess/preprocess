import { loader } from "fumadocs-core/source";

import { docs } from "./collections";
import { openapi } from "./openapi";

export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({
      baseDir: "api",
      per: "operation",
      groupBy: "tag",
      // One flat page per operation in its tag's folder, named for what it
      // does rather than nested by path segment.
      name: ({ item, info }) =>
        (info.title.startsWith("/")
          ? `${item.method} ${info.title}`
          : info.title
        )
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
    }),
  },
  { baseUrl: "/", plugins: [openapi.loaderPlugin()] },
);
