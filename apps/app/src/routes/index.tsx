import { createFileRoute, redirect } from "@tanstack/react-router";

import { safeRedirect } from "../features/auth/safe-redirect";
import { landsOnInbox, loadHome } from "../features/home/home-api";
import { HomePage, HomeSkeleton } from "../features/home/home-page";
import { currentScenario } from "../scenarios/current-scenario";
import { Route as RootRoute } from "./__root";

// Home (PRE-178). An explicit ?redirect wins; people who only work cases
// arrive in the Inbox, with Home one click away in the sidebar.
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  loaderDeps: ({ search }) => ({ redirect: search.redirect }),
  loader: async ({ deps }) => {
    const next = safeRedirect(deps.redirect);
    if (next !== "/") throw redirect({ href: next });
    // The "loading" scenario shows the skeleton that client navigations show
    // while home loads.
    if (currentScenario().home === "loading") return { load: null };
    const load = await loadHome();
    // Only on arrival (the document load, as after sign-in): Home in the
    // sidebar still opens home.
    if (typeof window === "undefined" && landsOnInbox(load.home))
      throw redirect({ to: "/inbox" });
    return { load };
  },
  pendingComponent: HomeSkeleton,
  component: IndexPage,
});

function IndexPage() {
  const { load } = Route.useLoaderData();
  const { session } = RootRoute.useLoaderData();
  const firstName = session?.user.firstName?.trim() || null;
  if (!load) return <HomeSkeleton />;
  return <HomePage firstName={firstName} load={load} />;
}
