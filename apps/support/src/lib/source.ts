import { loader } from "fumadocs-core/source";

import { articles } from "./collections";

export const source = loader(
  { articles: articles.toFumadocsSource() },
  { baseUrl: "/" },
);
