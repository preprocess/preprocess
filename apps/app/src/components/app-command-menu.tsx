import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuInput,
  CommandMenuList,
  isMacPlatform,
  type CommandMenuItemData,
} from "@preprocess/ui/components/command-menu";
import {
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@preprocess/ui/components/sidebar";
import {
  BadgeCheck,
  OrbitSparkle,
  Folder4,
  Gauge,
  Globe,
  Inbox,
  Monitor,
  Moon,
  OpenRectArrowOut,
  Plug,
  Code,
  Plus,
  Search,
  Settings,
  Shield,
  Sun,
  User,
  Users,
} from "@preprocess/ui/lib/icons";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "../features/auth/auth-context";
import { useEffect, useMemo, useState } from "react";

import type { OrganizationSwitcher } from "./product-shell";
import { useTheme } from "./theme-provider";

type AppPath =
  | "/inbox"
  | "/cases"
  | "/agents"
  | "/settings/account"
  | "/settings/organization"
  | "/settings/organization/members"
  | "/settings/organization/groups"
  | "/settings/organization/audit-logs"
  | "/settings/organization/api-keys"
  | "/settings/organization/integrations"
  | "/settings/organization/github"
  | "/settings/organization/sandboxes"
  | "/settings/organization/secrets"
  | "/settings/organization/network"
  | "/developers/observability";

const PAGES: readonly {
  to: AppPath;
  label: string;
  group: string;
  icon: CommandMenuItemData["icon"];
  keywords?: readonly string[];
}[] = [
  {
    to: "/inbox",
    label: "Inbox",
    group: "Go to",
    icon: Inbox,
    keywords: ["notifications"],
  },
  { to: "/cases", label: "Cases", group: "Go to", icon: Folder4 },
  { to: "/agents", label: "Agents", group: "Go to", icon: OrbitSparkle },
  { to: "/settings/account", label: "Profile", group: "Account", icon: User },
  {
    to: "/settings/organization",
    label: "Organization settings",
    group: "Organization",
    icon: Settings,
  },
  {
    to: "/settings/organization/members",
    label: "Members",
    group: "Organization",
    icon: Users,
    keywords: ["invite", "team"],
  },
  {
    to: "/settings/organization/groups",
    label: "Groups",
    group: "Organization",
    icon: Users,
    keywords: ["developers", "access"],
  },
  {
    to: "/settings/organization/audit-logs",
    label: "Audit log",
    group: "Organization",
    icon: Shield,
    keywords: ["audit", "events", "verify"],
  },
  {
    to: "/developers/observability",
    label: "Observability",
    group: "Go to",
    icon: Gauge,
    keywords: ["logs", "traces", "metrics", "monitoring"],
  },
  {
    to: "/settings/organization/api-keys",
    label: "API keys & webhooks",
    group: "Developers",
    icon: BadgeCheck,
    keywords: [
      "api keys",
      "byok",
      "bring your own key",
      "encryption",
      "webhooks",
      "events",
    ],
  },
  {
    to: "/settings/organization/integrations",
    label: "Integrations",
    group: "Developers",
    icon: Plug,
    keywords: [
      "mcp",
      "mcp servers",
      "model context protocol",
      "tools",
      "connectors",
    ],
  },
  {
    to: "/settings/organization/github",
    label: "GitHub",
    group: "Developers",
    icon: Code,
    keywords: ["github", "repositories", "repos", "push", "deploy", "app"],
  },
  {
    to: "/settings/organization/secrets",
    label: "Secrets",
    group: "Developers",
    icon: Shield,
    keywords: ["environment", "env", "variables"],
  },
  {
    to: "/settings/organization/network",
    label: "Network",
    group: "Developers",
    icon: Globe,
    keywords: ["allowlist", "blocklist", "internet", "urls"],
  },
  {
    to: "/settings/organization/sandboxes",
    label: "Sandboxes",
    group: "Developers",
    icon: Monitor,
    keywords: ["docker", "container", "image"],
  },
];

// ⌘K on a Mac, Ctrl K elsewhere. Read after mount so the server render and
// the first client render agree.
function useShortcutLabel() {
  const [label, setLabel] = useState("⌘K");
  useEffect(() => {
    if (!isMacPlatform()) setLabel("Ctrl K");
  }, []);
  return label;
}

/** The "Search" row at the top of the sidebar. */
export function AppCommandSearchTrigger({ onOpen }: { onOpen: () => void }) {
  const shortcut = useShortcutLabel();
  return (
    <SidebarMenu aria-label="Search">
      <SidebarMenuItem>
        <SidebarMenuButton icon={Search} onClick={onOpen}>
          Search
        </SidebarMenuButton>
        <SidebarMenuBadge>{shortcut}</SidebarMenuBadge>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppCommandMenu({
  open,
  onOpenChange,
  switcher,
  onCreateOrganization,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  switcher: OrganizationSwitcher;
  onCreateOrganization: () => void;
}) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  const items = useMemo((): CommandMenuItemData[] => {
    const pages = PAGES.map((page): CommandMenuItemData => ({
      value: page.to,
      label: page.label,
      action: `Open ${page.label}`,
      group: page.group,
      icon: page.icon,
      keywords: page.keywords,
      onSelect: () => {
        void navigate({ to: page.to });
      },
    }));
    const organizations = switcher.organizations
      .filter((candidate) => candidate.id !== switcher.current.id)
      .map((candidate): CommandMenuItemData => ({
        value: `organization:${candidate.id}`,
        label: `Switch to ${candidate.name}`,
        group: "Organization",
        disabled: switcher.switching,
        onSelect: () => {
          void switcher.switchTo(candidate.id);
        },
      }));
    return [
      ...pages,
      ...organizations,
      {
        value: "organization:create",
        label: "Create organization",
        group: "Organization",
        icon: Plus,
        onSelect: onCreateOrganization,
      },
      {
        value: "theme",
        label: dark ? "Switch to light mode" : "Switch to dark mode",
        group: "Preferences",
        icon: dark ? Sun : Moon,
        keywords: ["theme", "appearance"],
        onSelect: () => setTheme(dark ? "light" : "dark"),
      },
      {
        value: "sign-out",
        label: "Sign out",
        group: "Preferences",
        icon: OpenRectArrowOut,
        keywords: ["log out"],
        onSelect: () => {
          void signOut();
        },
      },
    ];
  }, [dark, navigate, onCreateOrganization, setTheme, signOut, switcher]);

  return (
    <CommandMenuDialog
      description="Go to a page or run an action."
      onOpenChange={onOpenChange}
      open={open}
      title="Search"
    >
      <CommandMenu items={items}>
        <CommandMenuInput placeholder="Search pages and actions…" />
        <CommandMenuList>
          <CommandMenuEmpty>Nothing matches.</CommandMenuEmpty>
        </CommandMenuList>
        <CommandMenuFooter />
      </CommandMenu>
    </CommandMenuDialog>
  );
}
