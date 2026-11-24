import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { FluidProvider } from "@preprocess/ui/lib/fluid-provider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { AuthKitProvider } from "@workos/authkit-tanstack-react-start/client";
import type { AuthKitProviderProps } from "@workos/authkit-tanstack-react-start/client";
import type { ReactNode } from "react";

import { ProductShell } from "../components/product-shell";
import { loadProductSidebarOpen } from "../components/product-sidebar-open";
import { ProductSidebarOpenProvider } from "../components/product-sidebar-state";
import { ThemeProvider, ThemeScript } from "../components/theme-provider";
import { loadInbox } from "../features/inbox/load-inbox";
import { OrganizationsProvider } from "../features/organizations/organizations-context";
import { loadUserOrganizations } from "../features/organizations/user-organizations";
import { ClientApiSessionProvider } from "../features/workos-client-api/client-api-session";
import { isOnboardingPath } from "../server/onboarding-path";
import { ScenarioToolbar } from "../scenarios/scenario-toolbar";
import { isPublicAuthPath, isPublicCasePath } from "../server/public-auth-path";

import "@preprocess/ui/styles.css";
import "../styles.css";

const FAVICON_LIGHT = "/brand/favicon-light.png";
const FAVICON_DARK = "/brand/favicon-dark.png";

type AuthResult = Awaited<ReturnType<typeof getAuth>>;
type InitialAuth = NonNullable<AuthKitProviderProps["initialAuth"]>;

/** Strip the access token before shipping auth into the client provider. */
function toInitialAuth(auth: AuthResult): InitialAuth {
  if (!auth.user) {
    return { user: null };
  }

  const { accessToken: _accessToken, ...initialAuth } = auth;
  return initialAuth;
}

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
        rel: "icon",
        type: "image/png",
        href: FAVICON_LIGHT,
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "icon",
        type: "image/png",
        href: FAVICON_DARK,
        media: "(prefers-color-scheme: dark)",
      },
      {
        rel: "icon",
        type: "image/png",
        href: FAVICON_LIGHT,
      },
      {
        rel: "shortcut icon",
        href: "/favicon.ico",
      },
    ],
  }),
  loader: async ({ location }) => {
    const sidebarOpen = await loadProductSidebarOpen();

    if (
      isPublicAuthPath(location.pathname) ||
      isPublicCasePath(location.pathname)
    ) {
      return {
        initialAuth: { user: null } satisfies InitialAuth,
        inboxUnread: 0,
        organizations: [],
        sidebarOpen,
      };
    }

    const auth = await getAuth();
    if (!auth.user) {
      const returnPathname = `${location.pathname}${location.searchStr}`;
      // TanStack Router redirects are Response objects, not Error instances.
      throw redirect({
        href: `/api/auth/sign-in?returnPathname=${encodeURIComponent(returnPathname)}`,
      });
    }

    const organizationId = auth.organizationId ?? null;
    const onOnboarding = isOnboardingPath(location.pathname);

    if (!organizationId && !onOnboarding) {
      throw redirect({ to: "/onboarding" });
    }

    if (organizationId && onOnboarding) {
      throw redirect({ to: "/" });
    }

    const [organizations, inbox] = await Promise.all([
      loadUserOrganizations(),
      organizationId ? loadInbox() : Promise.resolve({ unreadCount: 0 }),
    ]);
    return {
      initialAuth: toInitialAuth(auth),
      inboxUnread: inbox.unreadCount,
      organizations,
      sidebarOpen,
    };
  },
  // Auth, organizations, and the unread count load with the document. Client
  // navigation keeps them; marking inbox items read invalidates the router,
  // and organization switches reload the page.
  shouldReload: false,
  shellComponent: RootDocument,
  component: RootComponent,
});

// Settings data from the WorkOS Client API. One client per browser tab.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});

function RootComponent() {
  const { inboxUnread, initialAuth, organizations, sidebarOpen } =
    Route.useLoaderData();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  // One shell for every product route, so navigating swaps only the page.
  const outlet =
    isPublicAuthPath(pathname) || isOnboardingPath(pathname) ? (
      <Outlet />
    ) : (
      <ProductShell inboxUnread={inboxUnread}>
        <Outlet />
      </ProductShell>
    );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthKitProvider initialAuth={initialAuth}>
        <ClientApiSessionProvider>
          <OrganizationsProvider organizations={organizations}>
            <ProductSidebarOpenProvider open={sidebarOpen}>
              {outlet}
              {import.meta.env.DEV ? <ScenarioToolbar /> : null}
            </ProductSidebarOpenProvider>
          </OrganizationsProvider>
        </ClientApiSessionProvider>
      </AuthKitProvider>
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
