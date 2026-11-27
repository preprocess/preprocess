import type { AnyRoute } from "@tanstack/react-router";
import { createMiddleware, createStart } from "@tanstack/react-start";

import { routeTree } from "./routeTree.gen";

const CHUNK_OPTIONS = [
  "component",
  "pendingComponent",
  "errorComponent",
  "notFoundComponent",
] as const;

function* routes(route: AnyRoute): Generator<AnyRoute> {
  yield route;
  const children = (route.children ?? {}) as Record<string, AnyRoute>;
  for (const child of Object.values(children)) yield* routes(child);
}

/**
 * Dev only: every request loads every route's split components before it is
 * handled. Under `vite dev` a dynamic import belongs to the request that
 * started it and never settles if that request ends first, and the router
 * keeps the pending import for later requests. So one early exit, such as a
 * signed-out /cases redirecting to /sign-in, left the route hanging until a
 * restart (cloudflare/workers-sdk#14917). Awaiting the imports here settles
 * each one in the request that started it. Builds bundle the chunks, so
 * nothing runs outside dev.
 */
const settleRouteChunks = createMiddleware().server(async ({ next }) => {
  if (import.meta.env.DEV)
    await Promise.all(
      [...routes(routeTree)].flatMap((route) =>
        CHUNK_OPTIONS.flatMap((key) => {
          const component = route.options[key] as
            { preload?: () => Promise<void> } | undefined;
          return component?.preload ? [component.preload()] : [];
        }),
      ),
    );
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [settleRouteChunks],
}));
