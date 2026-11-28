import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";

import type { HelpArticle } from "@/lib/help";

import { HelpLink } from "./help-link";

// A category's articles as a plain list in the docs' prose: each title
// links to its article, with its description after it.
export function ArticleList({ articles }: { articles: HelpArticle[] }) {
  return (
    <ul>
      {articles.map((article) => (
        <li key={article.url}>
          <HelpLink url={article.url}>{article.title}</HelpLink>
          {article.description ? (
            <span className={cn(typeClass("body"), "text-muted-foreground")}>
              {" "}
              {article.description}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
