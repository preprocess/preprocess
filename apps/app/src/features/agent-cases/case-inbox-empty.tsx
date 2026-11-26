import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@preprocess/ui/components/empty";

import { CasesEmptyArt, NoMatchArt } from "../../components/empty-art";

export type CaseInboxEmptyKind = "unavailable" | "empty" | "no-match";

export function CaseInboxEmpty({
  kind,
  query,
}: {
  kind: CaseInboxEmptyKind;
  query?: string;
}) {
  const trimmedQuery = query?.trim() ?? "";
  let title: string;
  let description: string;
  switch (kind) {
    case "unavailable":
      title = "Cases are unavailable";
      description = "Try again in a moment.";
      break;
    case "empty":
      title = "No cases yet";
      description = "Cases you can open will show up here.";
      break;
    case "no-match":
      title = "No cases match";
      description =
        trimmedQuery === ""
          ? "Nothing matches these filters."
          : `Nothing matches “${trimmedQuery}”.`;
      break;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }

  return (
    <Empty
      className="pointer-events-none absolute inset-0 z-[1] border-0 p-0"
      role={kind === "unavailable" ? "alert" : undefined}
    >
      <EmptyHeader className="pointer-events-auto group max-w-md">
        <EmptyMedia variant="graphic">
          {kind === "no-match" ? <NoMatchArt /> : <CasesEmptyArt />}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
