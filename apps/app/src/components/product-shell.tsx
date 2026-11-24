import { MenuItem } from "@preprocess/ui/components/menu-item";
import { DropdownSeparator } from "@preprocess/ui/components/dropdown";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@preprocess/ui/components/sidebar";
import {
  OrbitSparkle,
  Folder4,
  Gauge,
  Globe,
  Inbox,
  Lock,
  Monitor,
  Moon,
  OpenRectArrowOut,
  Plug,
  Plus,
  Settings,
  Shield,
  Sun,
} from "@preprocess/ui/lib/icons";
import type { IconComponent } from "@preprocess/ui/lib/icon-context";
import { ShapeProvider } from "@preprocess/ui/lib/shape-context";
import { SurfaceProvider } from "@preprocess/ui/lib/surface-context";
import {
  Link,
  useMatches,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { useContext, useState, type ReactNode } from "react";

import { useOrganizations } from "../features/organizations/organizations-context";
import type { UserOrganization } from "../features/organizations/user-organization";
import { useOptionalClientApiSession } from "../features/workos-client-api/client-api-session";
import { AppCommandMenu, AppCommandSearchTrigger } from "./app-command-menu";
import { CreateOrganizationDialog } from "./create-organization-dialog";
import { ProductSidebarOpenContext } from "./product-sidebar-state";
import { SidebarInsetTopbar } from "./sidebar-app/inset-topbar";
import { SidebarUserFooter } from "./sidebar-app/user-footer";
import {
  SidebarWorkspaceHeader,
  WorkspaceTile,
} from "./sidebar-app/workspace-header";
import { useTheme } from "./theme-provider";

type NavItem = {
  to:
    | "/inbox"
    | "/cases"
    | "/agents"
    | "/developers/api"
    | "/developers/integrations"
    | "/developers/sandboxes"
    | "/developers/secrets"
    | "/developers/network"
    | "/developers/observability";
  label: string;
  icon: IconComponent;
  unread?: number;
};

function isCurrent(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (first && second) {
    return `${first[0]}${second[0]}`.toUpperCase();
  }
  return (first ?? name).slice(0, 2).toUpperCase() || "?";
}

function displayName(user: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.email;
}

function resolveCurrentOrganization(
  organizations: UserOrganization[],
  organizationId: string | undefined,
): UserOrganization {
  return (
    organizations.find((candidate) => candidate.id === organizationId) ??
    organizations.find((candidate) => candidate.isCurrent) ??
    (organizationId
      ? { id: organizationId, name: "Organization" }
      : organizations[0]) ?? { id: "", name: "Organization" }
  );
}

export type OrganizationSwitcher = {
  organizations: UserOrganization[];
  current: UserOrganization;
  switching: boolean;
  switchTo: (organizationId: string) => Promise<void>;
};

function useOrganizationSwitcher(
  organizationsProp?: UserOrganization[],
): OrganizationSwitcher {
  const { organizationId, switchToOrganization } = useAuth();
  const client = useOptionalClientApiSession();
  const contextOrganizations = useOrganizations();
  const organizations =
    organizationsProp ??
    (client?.organizations.length
      ? client.organizations
      : contextOrganizations);
  const current = resolveCurrentOrganization(organizations, organizationId);
  const [switching, setSwitching] = useState(false);

  async function switchTo(nextId: string) {
    if (!nextId || nextId === organizationId || switching) return;
    setSwitching(true);
    try {
      const switched = await switchToOrganization(nextId);
      if (switched && "error" in switched && switched.error) {
        setSwitching(false);
        return;
      }
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  }

  return { organizations, current, switching, switchTo };
}

function OrganizationHeader({
  switcher,
  onCreate,
}: {
  switcher: OrganizationSwitcher;
  onCreate: () => void;
}) {
  const navigate = useNavigate();
  const { organizations, current: org, switching, switchTo } = switcher;
  const checkedIndex = organizations.findIndex(
    (candidate) => candidate.id === org.id,
  );

  return (
    <SidebarWorkspaceHeader
      name={org.name}
      tile={<WorkspaceTile>{initialsOf(org.name).slice(0, 1)}</WorkspaceTile>}
      checkedIndex={checkedIndex >= 0 ? checkedIndex : undefined}
      menu={
        <>
          {organizations.map((candidate, index) => (
            <MenuItem
              checked={candidate.id === org.id}
              disabled={switching}
              index={index}
              key={candidate.id}
              label={candidate.name}
              onSelect={() => {
                void switchTo(candidate.id);
              }}
            />
          ))}
          <DropdownSeparator />
          <MenuItem
            icon={Settings}
            index={organizations.length}
            label="Organization settings"
            onSelect={() => {
              void navigate({ to: "/settings/organization" });
            }}
          />
          <MenuItem
            icon={Plus}
            index={organizations.length + 1}
            label="Create organization"
            onSelect={onCreate}
          />
        </>
      }
    />
  );
}

let lastProfilePictureUrl: string | null = null;

function UserFooter() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const name = user ? displayName(user) : loading ? "Loading…" : "Account";
  if (user?.profilePictureUrl) {
    lastProfilePictureUrl = user.profilePictureUrl;
  }
  const profilePictureUrl = user
    ? user.profilePictureUrl
    : loading
      ? lastProfilePictureUrl
      : null;
  const dark = resolvedTheme === "dark";

  return (
    <SidebarUserFooter
      name={name}
      avatar={
        profilePictureUrl ? (
          <img
            alt=""
            className="size-5 rounded-full object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
            src={profilePictureUrl}
          />
        ) : (
          <span className="flex size-5 items-center justify-center rounded-full bg-muted-foreground text-[length:var(--fs-micro-compact,10px)] leading-[var(--lh-micro-compact,12px)] text-background">
            {initialsOf(name).slice(0, 1)}
          </span>
        )
      }
      menu={
        <>
          <MenuItem
            icon={Settings}
            index={0}
            label="Account settings"
            onSelect={() => {
              void navigate({ to: "/settings/account" });
            }}
          />
          <MenuItem
            icon={dark ? Sun : Moon}
            index={1}
            label={dark ? "Light mode" : "Dark mode"}
            onSelect={() => setTheme(dark ? "light" : "dark")}
          />
          <MenuItem
            icon={OpenRectArrowOut}
            index={2}
            label="Sign out"
            onSelect={() => {
              void signOut();
            }}
          />
        </>
      }
    />
  );
}

const DEVELOPER_NAV: readonly NavItem[] = [
  { to: "/developers/observability", label: "Observability", icon: Gauge },
  { to: "/developers/api", label: "Keys & webhooks", icon: Lock },
  { to: "/developers/integrations", label: "Integrations", icon: Plug },
  { to: "/developers/secrets", label: "Secrets", icon: Shield },
  { to: "/developers/network", label: "Network", icon: Globe },
  { to: "/developers/sandboxes", label: "Sandbox images", icon: Monitor },
];

function NavRows({
  items,
  pathname,
  label,
}: {
  items: readonly NavItem[];
  pathname: string;
  label: string;
}) {
  return (
    // gap-1: the 4px between items every list in the app uses.
    <SidebarMenu aria-label={label} className="gap-1">
      {items.map((item) => (
        <SidebarMenuItem key={item.to}>
          <SidebarMenuButton
            icon={item.icon}
            isActive={isCurrent(pathname, item.to)}
            render={<Link to={item.to} />}
          >
            {item.label}
          </SidebarMenuButton>
          {item.unread ? (
            <SidebarMenuBadge>{item.unread}</SidebarMenuBadge>
          ) : null}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

function ProductSidebar({
  inboxUnread,
  organizations,
}: {
  inboxUnread: number;
  organizations?: UserOrganization[];
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const switcher = useOrganizationSwitcher(organizations);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const nav: readonly NavItem[] = [
    { to: "/inbox", label: "Inbox", icon: Inbox, unread: inboxUnread },
    { to: "/cases", label: "Cases", icon: Folder4 },
    { to: "/agents", label: "Agents", icon: OrbitSparkle },
  ];

  // The app is pill-shaped; the sidebar's rows and menus read better rounded.
  return (
    <ShapeProvider defaultShape="rounded">
      <Sidebar rail={false} variant="inset">
        <SidebarHeader>
          <OrganizationHeader
            onCreate={() => setCreateOpen(true)}
            switcher={switcher}
          />
          <AppCommandSearchTrigger onOpen={() => setSearchOpen(true)} />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <NavRows
              items={nav}
              label="Primary navigation"
              pathname={pathname}
            />
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Developers</SidebarGroupLabel>
            <NavRows
              items={DEVELOPER_NAV}
              label="Developers"
              pathname={pathname}
            />
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <UserFooter />
        </SidebarFooter>
      </Sidebar>
      <AppCommandMenu
        onCreateOrganization={() => setCreateOpen(true)}
        onOpenChange={setSearchOpen}
        open={searchOpen}
        switcher={switcher}
      />
      {createOpen ? (
        <CreateOrganizationDialog
          onOpenChange={setCreateOpen}
          open={createOpen}
        />
      ) : null}
    </ShapeProvider>
  );
}

function ProductShell({
  children,
  inboxUnread = 0,
  organizations,
}: Readonly<{
  children?: ReactNode;
  inboxUnread?: number;
  organizations?: UserOrganization[];
}>) {
  const defaultOpen = useContext(ProductSidebarOpenContext);
  const ownsHeader = useMatches({
    select: (matches) =>
      matches.some((match) => match.staticData.ownsHeader === true),
  });

  return (
    <SidebarProvider
      className="h-svh"
      data-testid="product-shell"
      defaultOpen={defaultOpen}
      shortcut={null}
    >
      <ProductSidebar inboxUnread={inboxUnread} organizations={organizations} />
      <SidebarInset className="min-h-0 overflow-hidden">
        {ownsHeader ? null : <SidebarInsetTopbar />}
        {/* The inset panel paints surface-2 without declaring it, so elevated
            content (settings cards, popovers) would land on the same step. */}
        <SurfaceProvider value={2}>
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </main>
        </SurfaceProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}

export { ProductShell };
