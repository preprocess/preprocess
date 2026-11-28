import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { FluidProvider } from "@preprocess/ui/lib/fluid-provider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { ProductShell } from "../components/product-shell";
import { loadProductSidebarOpen } from "../components/product-sidebar-open";
import { ProductSidebarOpenProvider } from "../components/product-sidebar-state";
import { ThemeProvider, ThemeScript } from "../components/theme-provider";
import { AuthProvider } from "../features/auth/auth-context";
import { safeRedirect } from "../features/auth/safe-redirect";
import {
  activateOrganization,
  loadOrganizations,
  loadSession,
  needsName,
} from "../features/auth/session";
import { loadInbox } from "../features/inbox/load-inbox";
import {
  loadMonitoring,
  startMonitoring,
} from "../features/monitoring/posthog";
import { onDataChanged } from "../lib/data-changed";
import { loadRequiredCheckout } from "../features/organizations/billing";
import { OrganizationsProvider } from "../features/organizations/organizations-context";
import { SettingsEmptyArtScope } from "../features/settings/kit";
import { isOnboardingPath } from "../server/onboarding-path";
import { ScenarioToolbar } from "../scenarios/scenario-toolbar";
import { isPublicAuthPath } from "../server/public-auth-path";

import "@preprocess/ui/styles.css";
import "../styles.css";

const NAME_PATH = "/onboarding/name";
// Approving `preprocess login` needs a session but renders without the shell.
const DEVICE_PATH = "/device";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Preprocess",
      },
      {
        name: "description",
        content: "Preprocess product application",
      },
    ],
    links: [
      {
        rel: "preload",
        href: "/fonts/InterVariable.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  // Loaders run in parallel, so the active organization has to be set
  // before any of them asks the API for it. Only the document load needs it:
  // sign-in, invitations, and organization switches all reload the page.
  beforeLoad: async ({ location }) => {
    if (typeof document !== "undefined") return;
    if (isPublicAuthPath(location.pathname)) return;
    const session = await loadSession();
    if (!session || session.organizationId) return;
    const [first] = await loadOrganizations();
    if (first)
      await activateOrganization({ data: { organizationId: first.id } });
  },
  loader: async ({ location }) => {
    const [sidebarOpen, monitoring] = await Promise.all([
      loadProductSidebarOpen(),
      loadMonitoring(),
    ]);

    if (isPublicAuthPath(location.pathname)) {
      return {
        session: null,
        inboxUnread: 0,
        organizations: [],
        sidebarOpen,
        monitoring,
      };
    }

    // Every gate passes the page the person was going to along as `redirect`.
    const redirectTo = `${location.pathname}${location.searchStr}`;
    const session = await loadSession();
    if (!session) {
      // TanStack Router redirects are Response objects, not Error instances.
      throw redirect({
        href: `/sign-in?redirect=${encodeURIComponent(redirectTo)}`,
      });
    }

    // Names come before everything else, however the person signed in.
    const onName = location.pathname === NAME_PATH;
    if (needsName(session.user) && !onName) {
      throw redirect({
        href: `${NAME_PATH}?redirect=${encodeURIComponent(redirectTo)}`,
      });
    }
    if (onName && !needsName(session.user)) throw redirect({ to: "/" });

    const organizations = await loadOrganizations();

    const onOnboarding = isOnboardingPath(location.pathname);
    if (!onName && !session.organizationId && !onOnboarding) {
      throw redirect({
        href:
          redirectTo === "/"
            ? "/onboarding"
            : `/onboarding?redirect=${encodeURIComponent(redirectTo)}`,
      });
    }
    if (!onName && session.organizationId && onOnboarding) {
      throw redirect({
        href: safeRedirect(
          new URLSearchParams(location.searchStr).get("redirect"),
        ),
      });
    }

    // Once cards are required, an Owner whose organization has no plan yet
    // goes to checkout to start Free (spec 16a), and comes back here.
    if (!onName && session.organizationId) {
      const checkout = await loadRequiredCheckout({ data: redirectTo });
      if (checkout) throw redirect({ href: checkout });
    }

    const inbox = session.organizationId
      ? await loadInbox()
      : { unreadCount: 0 };
    return {
      session,
      inboxUnread: inbox.unreadCount,
      organizations,
      sidebarOpen,
      monitoring,
    };
  },
  // Auth, organizations, and the unread count load with the document. Client
  // navigation keeps them; marking inbox items read invalidates the router,
  // and organization switches reload the page.
  shouldReload: false,
  shellComponent: RootDocument,
  component: RootComponent,
});

// Settings data from the API. One client per browser tab.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});

function RootComponent() {
  const { inboxUnread, session, organizations, sidebarOpen, monitoring } =
    Route.useLoaderData();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const router = useRouter();
  const userId = session?.user.id;
  const organizationId = session?.organizationId ?? null;
  useEffect(
    () =>
      startMonitoring(monitoring, userId ? { userId, organizationId } : null),
    [monitoring, userId, organizationId],
  );
  useEffect(
    () =>
      onDataChanged(() => {
        void router.invalidate();
        void queryClient.invalidateQueries();
      }),
    [router],
  );
  // One shell for every product route, so navigating swaps only the page.
  const outlet =
    isPublicAuthPath(pathname) ||
    isOnboardingPath(pathname) ||
    pathname === DEVICE_PATH ? (
      <Outlet />
    ) : (
      <ProductShell inboxUnread={inboxUnread}>
        <SettingsEmptyArtScope>
          <Outlet />
        </SettingsEmptyArtScope>
      </ProductShell>
    );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider session={session}>
        <OrganizationsProvider organizations={organizations}>
          <ProductSidebarOpenProvider open={sidebarOpen}>
            {outlet}
            {import.meta.env.DEV ? <ScenarioToolbar /> : null}
          </ProductSidebarOpenProvider>
        </OrganizationsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // Do not set `className` on <html> — React would overwrite ThemeScript's
    // `dark`/`light` classes on hydrate and flash the theme toggle icons.
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript defaultTheme="system" storageKey="preprocess-theme" />
        <HeadContent />
        {/* Outside head().meta, which keeps one meta per name. */}
        <meta
          name="theme-color"
          content="#fbf7f0"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#15120f"
          media="(prefers-color-scheme: dark)"
        />
      </head>
      <body className="fixed inset-0 h-svh overflow-hidden overscroll-none">
        <ThemeProvider defaultTheme="system" storageKey="preprocess-theme">
          <FluidProvider shape="pill">{children}</FluidProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
