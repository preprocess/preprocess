import { createRouter } from "@tanstack/react-router";

import { RouteError } from "./components/route-states";
import { routeTree } from "./routeTree.gen";
// Keep the build:probe entry reachable; real builds define its guard as false.
import "./bundle-probe";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: RouteError,
    scrollRestoration: true,
    // Revisiting a page within 15 s reuses its loader data; any write the
    // browser makes marks it stale first (lib/data-changed.ts).
    defaultStaleTime: 15_000,
    // Resting on or focusing a link for 200 ms loads its page; that data
    // serves the click for 30 s. A pointer crossing the sidebar on its way
    // elsewhere passes each item faster, so it preloads none of them.
    defaultPreload: "intent",
    defaultPreloadDelay: 200,
    defaultPreloadStaleTime: 30_000,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
