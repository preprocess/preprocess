"use client";

// Settings' section sidebar (spec 14a): account and organization pages in
// one grouped list inside the page, the current page a filled row, and the
// sections of a long page as anchors under it. On a narrow panel it becomes
// a switcher above the page.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@preprocess/ui/components/sidebar-menu";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { ShapeProvider } from "@preprocess/ui/lib/shape-context";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";

type Page = {
  to:
    | "/settings/account"
    | "/settings/organization"
    | "/settings/organization/members"
    | "/settings/organization/groups"
    | "/settings/organization/defaults"
    | "/settings/organization/guardrails"
    | "/settings/organization/audit-logs";
  label: string;
  anchors?: readonly { id: string; label: string }[];
};

export const GUARDRAIL_SECTIONS = [
  { id: "requests", label: "Requests" },
  { id: "network", label: "Network" },
  { id: "spending", label: "Spending limit" },
  { id: "models", label: "Model endpoints" },
] as const;

const GROUPS: readonly { label: string; pages: readonly Page[] }[] = [
  {
    label: "Account",
    pages: [{ to: "/settings/account", label: "Profile" }],
  },
  {
    label: "Organization",
    pages: [
      { to: "/settings/organization", label: "General" },
      { to: "/settings/organization/members", label: "Members" },
      { to: "/settings/organization/groups", label: "Groups" },
      { to: "/settings/organization/defaults", label: "Defaults" },
      {
        to: "/settings/organization/guardrails",
        label: "Guardrails",
        anchors: GUARDRAIL_SECTIONS,
      },
      { to: "/settings/organization/audit-logs", label: "Audit log" },
    ],
  },
];

const PAGES = GROUPS.flatMap((group) => group.pages);

// The deepest page the path is under; group detail keeps Groups selected.
export function currentSettingsPage(pathname: string): Page | undefined {
  const path = pathname
    .replace(/\/+$/, "")
    .replace("/settings/organization_/", "/settings/organization/");
  return PAGES.filter(
    (page) => path === page.to || path.startsWith(`${page.to}/`),
  ).sort((a, b) => b.to.length - a.to.length)[0];
}

function usePathname() {
  return useRouterState({ select: (state) => state.location.pathname });
}

export function SettingsNav() {
  const current = currentSettingsPage(usePathname());
  const hash = useRouterState({ select: (state) => state.location.hash });
  return (
    <ShapeProvider defaultShape="rounded">
      <nav
        aria-label="Settings"
        className="hidden w-[220px] shrink-0 flex-col gap-5 border-r border-border/60 px-3 py-8 md:flex"
      >
        {GROUPS.map((group) => (
          <div className="flex flex-col gap-1" key={group.label}>
            <h2
              className="px-2 text-caption text-muted-foreground"
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              {group.label}
            </h2>
            <SidebarMenu aria-label={group.label} className="gap-1">
              {group.pages.map((page) => (
                <SidebarMenuItem key={page.to}>
                  <SidebarMenuButton
                    isActive={page === current && !(page.anchors && hash)}
                    render={<Link to={page.to} />}
                  >
                    {page.label}
                  </SidebarMenuButton>
                  {page.anchors && page === current ? (
                    <SidebarMenuSub>
                      {page.anchors.map((anchor) => (
                        <SidebarMenuSubItem key={anchor.id}>
                          <SidebarMenuSubButton
                            isActive={hash === anchor.id}
                            render={<Link hash={anchor.id} to={page.to} />}
                          >
                            {anchor.label}
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </div>
        ))}
      </nav>
    </ShapeProvider>
  );
}

/** The section switcher that replaces the sidebar on a narrow panel. */
export function SettingsSwitcher() {
  const navigate = useNavigate();
  const current = currentSettingsPage(usePathname());
  return (
    <div className="md:hidden">
      <Select
        onValueChange={(to) => {
          const page = PAGES.find((p) => p.to === to);
          if (page) void navigate({ to: page.to });
        }}
        value={current?.to ?? ""}
      >
        <SelectTrigger aria-label="Settings section" className="w-56" />
        <SelectContent>
          {PAGES.map((page, index) => (
            <SelectItem index={index} key={page.to} value={page.to}>
              {page.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
