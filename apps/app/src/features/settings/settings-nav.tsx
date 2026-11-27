"use client";

// Settings' section sidebar (spec 14a): account and organization pages in
// one grouped list inside the page, the current page a filled row, and the
// sections of a long page as anchors under it. On a narrow panel it becomes
// a switcher above the page.

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { ShapeProvider } from "@preprocess/ui/lib/shape-context";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";

import { useBilling, useIsOwner } from "../billing/billing-api";
import { billingShown } from "../billing/billing-types";
import { currentScenario } from "../../scenarios/current-scenario";
import { useAdministers } from "./use-role";

type Page = {
  to:
    | "/settings/account"
    | "/settings/organization"
    | "/settings/organization/members"
    | "/settings/organization/groups"
    | "/settings/organization/defaults"
    | "/settings/organization/guardrails"
    | "/settings/organization/audit-logs"
    | "/settings/organization/retention"
    | "/settings/organization/opentelemetry"
    | "/settings/organization/billing"
    | "/settings/organization/api-keys"
    | "/settings/organization/github"
    | "/settings/organization/integrations"
    | "/settings/organization/secrets"
    | "/settings/organization/network"
    | "/settings/organization/sandboxes"
    | "/settings/organization/models";
  label: string;
  anchors?: readonly { id: string; label: string }[];
};

export const GUARDRAIL_SECTIONS = [
  { id: "requests", label: "Requests" },
  { id: "network", label: "Network" },
  { id: "spending", label: "Spending limit" },
  { id: "sandbox", label: "Sandbox size" },
  { id: "models", label: "Models" },
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
      { to: "/settings/organization/billing", label: "Billing" },
    ],
  },
  {
    label: "Developers",
    pages: [
      { to: "/settings/organization/api-keys", label: "API keys & webhooks" },
      { to: "/settings/organization/github", label: "GitHub" },
      { to: "/settings/organization/integrations", label: "Integrations" },
      { to: "/settings/organization/secrets", label: "Secrets" },
      { to: "/settings/organization/network", label: "Network" },
      { to: "/settings/organization/sandboxes", label: "Sandboxes" },
      { to: "/settings/organization/models", label: "Models" },
      {
        to: "/settings/organization/opentelemetry",
        label: "OpenTelemetry export",
      },
    ],
  },
  {
    label: "Governance",
    pages: [
      { to: "/settings/organization/defaults", label: "Defaults" },
      {
        to: "/settings/organization/guardrails",
        label: "Guardrails",
        anchors: GUARDRAIL_SECTIONS,
      },
      { to: "/settings/organization/audit-logs", label: "Audit log" },
      { to: "/settings/organization/retention", label: "Retention" },
    ],
  },
];

const PAGES = GROUPS.flatMap((group) =>
  group.pages.map((page) => ({ ...page, group: group.label })),
);

// The deepest page the path is under; group detail keeps Groups selected.
export function currentSettingsPage(pathname: string) {
  const path = pathname
    .replace(/\/+$/, "")
    .replace("/settings/organization_/", "/settings/organization/");
  return PAGES.filter(
    (page) => path === page.to || path.startsWith(`${page.to}/`),
  ).sort((a, b) => b.to.length - a.to.length)[0];
}

// Billing shows only to the Owner, on our cloud with billing on, once the plan
// has started or billing holds for the organization. Retention shows to Owners
// and Admins, self-hosted included; seeded retention states always show it.
function useVisible() {
  const owner = useIsOwner();
  const billing = useBilling();
  const administers = useAdministers();
  const showBilling =
    owner === true && Boolean(billing.data && billingShown(billing.data));
  const showRetention =
    administers === true || currentScenario().retention !== "live";
  return (page: Page) =>
    page.to === "/settings/organization/billing"
      ? showBilling
      : page.to === "/settings/organization/retention"
        ? showRetention
        : true;
}

function usePathname() {
  return useRouterState({ select: (state) => state.location.pathname });
}

export function SettingsNav() {
  const current = currentSettingsPage(usePathname());
  const hash = useRouterState({ select: (state) => state.location.hash });
  const visible = useVisible();
  return (
    <ShapeProvider defaultShape="rounded">
      <ScrollArea
        className="hidden min-h-0 w-[220px] shrink-0 border-r border-border/60 md:block"
        viewportClassName="scroll-fade overscroll-none"
      >
        <nav aria-label="Settings" className="flex flex-col gap-5 px-3 py-8">
          {GROUPS.map((group) => (
            <div className="flex flex-col gap-1" key={group.label}>
              <h2
                className="px-2 text-caption text-muted-foreground"
                style={{ fontVariationSettings: fontWeights.semibold }}
              >
                {group.label}
              </h2>
              <SidebarMenu aria-label={group.label} className="gap-1">
                {group.pages.filter(visible).map((page) => (
                  <SidebarMenuItem key={page.to}>
                    <SidebarMenuButton
                      isActive={
                        page.to === current?.to && !(page.anchors && hash)
                      }
                      render={<Link to={page.to} />}
                    >
                      {page.label}
                    </SidebarMenuButton>
                    {page.anchors && page.to === current?.to ? (
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
      </ScrollArea>
    </ShapeProvider>
  );
}

/** The section switcher that replaces the sidebar on a narrow panel. */
export function SettingsSwitcher() {
  const navigate = useNavigate();
  const current = currentSettingsPage(usePathname());
  const visible = useVisible();
  const items = PAGES.filter(visible).map((page) => page.to);
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
          {GROUPS.map((group) => (
            <SelectGroup key={group.label}>
              <SelectLabel
                style={{ fontVariationSettings: fontWeights.semibold }}
              >
                {group.label}
              </SelectLabel>
              {group.pages.filter(visible).map((page) => (
                <SelectItem
                  index={items.indexOf(page.to)}
                  key={page.to}
                  value={page.to}
                >
                  {page.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
