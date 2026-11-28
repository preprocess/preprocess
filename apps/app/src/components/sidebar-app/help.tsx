import { Button } from "@preprocess/ui/components/button";
import {
  DropdownContent,
  DropdownMenu,
  DropdownTrigger,
} from "@preprocess/ui/components/dropdown";
import { MenuItem } from "@preprocess/ui/components/menu-item";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@preprocess/ui/components/sidebar";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  CircleHelp,
  Mail,
} from "@preprocess/ui/lib/icons";
import { SIDEBAR_MENU_POPUP } from "@preprocess/ui/lib/sidebar-menu-grid";
import { getRouteApi } from "@tanstack/react-router";

const SUPPORT_EMAIL = "support@preprocess.com";

const rootRoute = getRouteApi("__root__");

function HelpMenuItems() {
  const { docsUrl, statusUrl } = rootRoute.useLoaderData({
    select: (d) => d.helpLinks,
  });
  return (
    <>
      {docsUrl ? (
        <MenuItem
          icon={BookOpen}
          index={0}
          label="Documentation"
          onSelect={() => {
            window.open(docsUrl, "_blank", "noopener,noreferrer");
          }}
          trailingIcon={ArrowUpRight}
        />
      ) : null}
      {statusUrl ? (
        <MenuItem
          icon={Activity}
          index={docsUrl ? 1 : 0}
          label="Status"
          onSelect={() => {
            window.open(statusUrl, "_blank", "noopener,noreferrer");
          }}
          trailingIcon={ArrowUpRight}
        />
      ) : null}
      <MenuItem
        icon={Mail}
        index={(docsUrl ? 1 : 0) + (statusUrl ? 1 : 0)}
        label="Contact support"
        onSelect={() => {
          window.location.href = `mailto:${SUPPORT_EMAIL}`;
        }}
      />
    </>
  );
}

export function SidebarHelp() {
  return (
    <SidebarMenu aria-label="Help">
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownTrigger
            render={
              <SidebarMenuButton icon={CircleHelp}>Help</SidebarMenuButton>
            }
          />
          <DropdownContent
            align="start"
            className={SIDEBAR_MENU_POPUP}
            side="top"
            sideOffset={6}
          >
            <HelpMenuItems />
          </DropdownContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function CollapsedHelpButton() {
  const { open, isMobile } = useSidebar();
  if (open || isMobile) return null;
  return (
    <DropdownMenu>
      <DropdownTrigger
        render={
          <Button
            aria-label="Help"
            size="icon-compact"
            type="button"
            variant="ghost"
          />
        }
      >
        <CircleHelp strokeWidth={1.15} />
      </DropdownTrigger>
      <DropdownContent
        align="start"
        className={SIDEBAR_MENU_POPUP}
        side="right"
        sideOffset={6}
      >
        <HelpMenuItems />
      </DropdownContent>
    </DropdownMenu>
  );
}
