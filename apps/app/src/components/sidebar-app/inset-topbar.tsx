import type { ReactNode } from "react";
import { SidebarTrigger, useSidebar } from "@preprocess/ui/components/sidebar";
import { cn } from "@preprocess/ui/lib/utils";

// ---------------------------------------------------------------------------
// The main region's topbar. While the sidebar is only PEEKED the trigger
// hides (the overlay covers it anyway); after a pin it fades back in
// slightly late, so it appears at its settled position instead of riding
// the inset's slide. Its hairline separates every page header from the pane
// below, whether the shell draws the topbar or a page's PageHeader does.
// ---------------------------------------------------------------------------

export function SidebarInsetTopbar({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const { isPeeking } = useSidebar();
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b border-border px-1.5",
        className,
      )}
    >
      <SidebarTrigger
        className={`transition-opacity delay-200 duration-160 ${
          isPeeking ? "opacity-0" : "opacity-100"
        }`}
      />
      {children}
    </header>
  );
}
