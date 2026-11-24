import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { SizeProvider } from "@preprocess/ui/lib/size-context";
import { cn } from "@preprocess/ui/lib/utils";
import type { ReactNode } from "react";

import { SidebarInsetTopbar } from "./sidebar-app/inset-topbar";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** The route renders its own PageHeader, so the shell drops its topbar. */
    ownsHeader?: boolean;
  }
}

/**
 * A page's one header row: the sidebar trigger, then the page's title and
 * views, then its actions on the trailing edge. Controls in it use the
 * compact step. Routes that render one set `staticData.ownsHeader`.
 */
export function PageHeader({
  children,
  trailing,
  sidebarTrigger = true,
  className,
}: Readonly<{
  children: ReactNode;
  trailing?: ReactNode;
  /** Off for a second pane's header, which sits away from the sidebar. */
  sidebarTrigger?: boolean;
  className?: string;
}>) {
  const content = (
    <SizeProvider size="compact">
      <div className="flex min-w-0 flex-1 items-center gap-3 pl-1.5">
        {children}
      </div>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-1 pr-1.5">
          {trailing}
        </div>
      ) : null}
    </SizeProvider>
  );

  // The hairline under the header is what separates it from the pane below.
  if (!sidebarTrigger) {
    return (
      <header
        className={cn(
          "flex h-12 shrink-0 items-center gap-2 border-b border-border px-1.5",
          className,
        )}
      >
        {content}
      </header>
    );
  }
  return (
    <SidebarInsetTopbar className={cn("border-b border-border", className)}>
      {content}
    </SidebarInsetTopbar>
  );
}

export function PageTitle({
  children,
  id,
}: Readonly<{ children: ReactNode; id?: string }>) {
  return (
    <h1
      className="shrink-0 truncate text-body text-foreground"
      id={id}
      style={{ fontVariationSettings: fontWeights.semibold }}
    >
      {children}
    </h1>
  );
}
