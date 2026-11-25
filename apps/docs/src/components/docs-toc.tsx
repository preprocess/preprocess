import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  ChevronDown,
  ChevronRight,
  TextAlignStart,
} from "@preprocess/ui/lib/icons";
import { spring } from "@preprocess/ui/lib/springs";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import {
  TOCScrollArea,
  useItems,
  useTOCItems,
} from "fumadocs-ui/components/toc";
import { TOCItem, TOCItems } from "fumadocs-ui/components/toc/clerk";
import { motion } from "motion/react";
import { useState } from "react";

import { Wordmark } from "./wordmark";

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

// Below lg, once the title scrolls away, the header's left side becomes the
// mark and the section in view; tapping it opens the contents over the page.
export function MobileContents({ title }: { title?: string }) {
  const [open, setOpen] = useState(false);
  const current = useCurrentSection();
  return (
    <>
      <motion.button
        animate={{ opacity: 1 }}
        aria-expanded={open}
        className={cn(typeClass("body"), "flex min-w-0 items-center gap-2")}
        initial={{ opacity: 0 }}
        onClick={() => setOpen(!open)}
        transition={spring.moderate}
        type="button"
      >
        <Wordmark className="size-4.5" markOnly />
        <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
        <span
          className="min-w-0 truncate text-foreground"
          style={{ fontVariationSettings: fontWeights.medium }}
        >
          {current ?? title}
        </span>
        <ChevronDown
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          size={14}
        />
      </motion.button>
      {open ? (
        <>
          <button
            aria-label="Close contents"
            className="fixed inset-0 top-13 z-10 bg-[rgb(var(--overlay)/0.2)]"
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
