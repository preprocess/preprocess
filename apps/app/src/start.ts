import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import {
  authkitMiddleware,
  checkSessionAction,
  getAccessTokenAction,
  getAuthAction,
  getOrganizationAction,
  refreshAccessTokenAction,
  refreshAuthAction,
  switchToOrganizationAction,
} from "@workos/authkit-tanstack-react-start";

// AuthKit is published with `"sideEffects": false`, so a bare middleware import
// tree-shakes away `actions.js`. Keep these bindings live so TanStack registers
// the client AuthKitProvider RPCs (checkSessionAction, etc.) at SSR boot.
void [
  checkSessionAction,
  getAuthAction,
  refreshAuthAction,
  getAccessTokenAction,
  refreshAccessTokenAction,
  switchToOrganizationAction,
  getOrganizationAction,
];

// Registering custom request middleware opts out of Start's default CSRF
// middleware — restore it for server-function RPC endpoints.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, authkitMiddleware()],
}));
