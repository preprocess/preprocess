import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { ChevronDown } from "@preprocess/ui/lib/icons";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import {
  TOCScrollArea,
  useItems,
  useTOCItems,
} from "fumadocs-ui/components/toc";
import { TOCItem, TOCItems } from "fumadocs-ui/components/toc/clerk";
import { useState } from "react";

// The table of contents in Fumadocs' clerk style: a track that follows each
// heading's depth and lights up the sections in view.
function TOCList({ onSelect }: { onSelect?: () => void }) {
  const items = useTOCItems();
  return (
    <TOCScrollArea>
      <TOCItems>
        {items.map((item) => (
          <TOCItem item={item} key={item.url} onClick={onSelect} />
        ))}
      </TOCItems>
    </TOCScrollArea>
  );
}

export function OnThisPage() {
  return (
    <nav aria-label="On this page" className="flex max-h-full flex-col">
      <p
        className={cn(typeClass("body"), "text-foreground")}
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        On this page
      </p>
      <TOCList />
    </nav>
  );
}

// Below xl the contents fold into a bar under the top bar that shows the
// section in view and opens the same list over the page.
export function OnThisPagePopover() {
  const [open, setOpen] = useState(false);
  const current = useItems().find((item) => item.active)?.original.title;
  return (
    <div className="relative z-10 shrink-0 border-b border-border bg-background xl:hidden">
      <button
        aria-expanded={open}
        className={cn(
          typeClass("body"),
          "flex h-10 w-full items-center gap-2 px-6 text-left text-muted-foreground md:px-12",
        )}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate">
          {open || !current ? "On this page" : current}
        </span>
        <ChevronDown
          className={cn("shrink-0 transition-transform", open && "rotate-180")}
          size={16}
        />
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full flex max-h-[50svh] flex-col border-b border-border bg-background px-6 md:px-12">
          <TOCList onSelect={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
