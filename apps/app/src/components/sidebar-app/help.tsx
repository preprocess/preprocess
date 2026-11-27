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
  ArrowUpRight,
  BookOpen,
  CircleHelp,
  Mail,
} from "@preprocess/ui/lib/icons";
import { SIDEBAR_MENU_POPUP } from "@preprocess/ui/lib/sidebar-menu-grid";

const DOCS_URL = "https://docs.preprocess.com";
const SUPPORT_EMAIL = "support@preprocess.com";

function HelpMenuItems() {
  return (
    <>
      <MenuItem
        icon={BookOpen}
        index={0}
        label="Documentation"
        onSelect={() => {
          window.open(DOCS_URL, "_blank", "noopener,noreferrer");
        }}
        trailingIcon={ArrowUpRight}
      />
      <MenuItem
        icon={Mail}
        index={1}
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
