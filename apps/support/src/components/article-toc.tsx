import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  ChevronDown,
  ChevronRight,
  TextAlignStart,
} from "@preprocess/ui/lib/icons";
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
    <TOCScrollArea className="docs-toc">
      <TOCItems>
        {items.map((item) => (
          <TOCItem item={item} key={item.url} onClick={onSelect} />
        ))}
      </TOCItems>
    </TOCScrollArea>
  );
}

function useCurrentSection() {
  return useItems().find((item) => item.active)?.original.title;
}

export function OnThisPage() {
  return (
    <nav aria-label="On this page" className="flex max-h-full flex-col gap-2.5">
      <p
        className={cn(
          typeClass("body"),
          "flex items-center gap-2 text-foreground",
        )}
        style={{ fontVariationSettings: fontWeights.medium }}
      >
        <TextAlignStart className="text-muted-foreground" size={14} />
        On this page
      </p>
      <TOCList />
    </nav>
  );
}

// Between lg and xl the panel shows but the TOC rail doesn't: the contents
// fold into a bar under the top bar that names the section in view and
// opens the same list over the page.
export function OnThisPagePopover() {
  const [open, setOpen] = useState(false);
  const current = useCurrentSection();
  return (
    <div className="relative z-10 hidden shrink-0 bg-surface-2 shadow-[inset_0_1px_0_var(--border),inset_0_-1px_0_var(--border)] lg:block xl:hidden">
      <button
        aria-expanded={open}
        className={cn(
          typeClass("body"),
          "flex h-11 w-full items-center gap-2 px-5 text-left text-foreground",
        )}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <TextAlignStart className="shrink-0 text-muted-foreground" size={14} />
        <span className="min-w-0 flex-1 truncate">
          {open || !current ? "On this page" : current}
        </span>
        {open ? (
          <ChevronDown className="shrink-0 text-muted-foreground" size={14} />
        ) : (
          <ChevronRight className="shrink-0 text-muted-foreground" size={14} />
        )}
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full flex max-h-[50svh] flex-col bg-surface-2 px-5 pt-2 pb-4 shadow-surface-3">
          <TOCList onSelect={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

// Below lg, once the title scrolls away, a second bar under the header
// names the section in view; tapping it opens the contents over the page.
export function MobileContents({ title }: { title?: string }) {
  const [open, setOpen] = useState(false);
  const current = useCurrentSection();
  return (
    <>
      <button
        aria-expanded={open}
        className={cn(
          typeClass("body"),
          "flex h-11 w-full items-center gap-2 px-5 text-left text-foreground",
        )}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <TextAlignStart className="shrink-0 text-muted-foreground" size={14} />
        <span
          className="min-w-0 flex-1 truncate"
          style={{ fontVariationSettings: fontWeights.medium }}
        >
          {current ?? title ?? "On this page"}
        </span>
        <ChevronDown
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          size={14}
        />
      </button>
      {open ? (
        <>
          <button
            aria-label="Close contents"
            className="fixed inset-0 top-24 z-10 bg-[rgb(var(--overlay)/0.2)]"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div className="absolute inset-x-3 top-full z-20 mt-1 flex max-h-[60svh] flex-col rounded-2xl bg-surface-2 px-4 pt-3.5 pb-4 shadow-surface-3">
            <TOCList onSelect={() => setOpen(false)} />
          </div>
        </>
      ) : null}
    </>
  );
}
