import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { SettingsNav } from "../features/settings/settings-nav";

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => {
    if (
      location.pathname === "/settings" ||
      location.pathname === "/settings/"
    ) {
      throw redirect({ to: "/settings/account" });
    }
  },
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <div className="flex min-h-0 flex-1">
      <SettingsNav />
      <ScrollArea
        className="min-h-0 flex-1"
        viewportClassName="scroll-fade overscroll-none"
      >
        {/* The pane that slides between a list and its detail (Groups). */}
        <div className="t-page-view">
          <Outlet />
        </div>
      </ScrollArea>
    </div>
  );
}
