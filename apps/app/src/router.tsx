import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";
// Keep the build:probe entry reachable; real builds define its guard as false.
import "./bundle-probe";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
