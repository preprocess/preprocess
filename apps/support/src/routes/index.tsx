import { createFileRoute } from "@tanstack/react-router";
import { Fragment } from "react";

import { HelpLink } from "@/components/help-link";
import { ArticleList } from "@/components/page-lists";
import { SupportArticle } from "@/components/support-article";
import {
  SearchTrigger,
  SupportShell,
  useOpenSearch,
} from "@/components/support-shell";
import type { HelpCenter } from "@/lib/help";
import { useHelp } from "@/lib/use-help";

export const Route = createFileRoute("/")({
  component: Home,
});

function SearchBox() {
  const open = useOpenSearch();
  return (
    <div className="not-typeset docs-app-step max-w-[480px]">
      <SearchTrigger onOpen={open} />
    </div>
  );
}

// A skeleton until Design's home page lands (PLAT-143): the search box, the
// six categories with their articles, and the way to contact support, in the
// docs' prose.
function HomeArticle({ help }: { help: HelpCenter }) {
  return (
    <SupportArticle
      description="Search help articles and the docs, or contact support."
      help={help}
      title="Help center"
      url="/"
    >
      <SearchBox />
      {help.categories.map((category) => (
        <Fragment key={category.slug}>
          <h2>
            <HelpLink url={category.url}>{category.title}</HelpLink>
          </h2>
          <ArticleList articles={category.articles} />
        </Fragment>
      ))}
      <h2>Contact support</h2>
      <p>
        Can’t find an answer?{" "}
        <HelpLink url="/contact">Contact support</HelpLink>.
      </p>
    </SupportArticle>
  );
}

function Home() {
  const help = useHelp();
  return (
    <SupportShell help={help} title="Help center">
      <HomeArticle help={help} />
    </SupportShell>
  );
}
