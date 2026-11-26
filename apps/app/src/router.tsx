import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";
// Keep the build:probe entry reachable; real builds define its guard as false.
import "./bundle-probe";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Revisiting a page within 15 s reuses its loader data; any write the
    // browser makes marks it stale first (lib/data-changed.ts).
    defaultStaleTime: 15_000,
    // Hovering or focusing a link for 100 ms loads its page; that data
    // serves the click for 30 s.
    defaultPreload: "intent",
    defaultPreloadDelay: 100,
    defaultPreloadStaleTime: 30_000,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
