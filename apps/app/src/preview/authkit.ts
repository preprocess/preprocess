/**
 * Preview stand-in for `@workos/authkit-tanstack-react-start`. vite.config.ts
 * aliases the package to this file only for `pnpm dev:preview`, so Capy
 * machines and other credential-less dev servers sign in without WorkOS.
 * Server-only work lives in ./session.server.ts, which refuses to run outside
 * the Vite dev server.
 */
import { redirect } from "@tanstack/react-router";
import { createMiddleware, createServerFn } from "@tanstack/react-start";

type AuthUrlOptions = { returnPathname?: string } | string | undefined;

export const authkitMiddleware = () =>
  createMiddleware().server(async ({ next }) => {
    const { isPreviewRuntime } = await import("./session.server");
    if (!isPreviewRuntime()) {
      throw new Error("The preview sign-in only runs under `vite dev`.");
    }
    return next();
  });

export const getAuth = createServerFn({ method: "GET" }).handler(async () => {
  const { readPreviewAuth } = await import("./session.server");
  return readPreviewAuth();
});

export const getSignInUrl = createServerFn({ method: "GET" })
  .validator((options?: AuthUrlOptions) => options)
  .handler(async ({ data }) => {
    const { safeReturnPath } = await import("./session.server");
    const returnPathname =
      typeof data === "string" ? undefined : data?.returnPathname;
    return `/api/auth/callback?returnPathname=${encodeURIComponent(safeReturnPath(returnPathname))}`;
  });

export const getSignUpUrl = getSignInUrl;

export const signOut = createServerFn({ method: "POST" })
  .validator((options?: { returnTo?: string }) => options)
  .handler(async () => {
    const { endPreviewSession } = await import("./session.server");
    endPreviewSession();
    throw redirect({ href: "/api/auth/callback?signedOut=1" });
  });

export const switchToOrganization = createServerFn({ method: "POST" })
  .validator((data: { organizationId: string; returnTo?: string }) => data)
  .handler(async () => {
    const { readPreviewAuth } = await import("./session.server");
    const auth = readPreviewAuth();
    if (!auth.user) throw new Error("Sign in to the preview first.");
    return auth;
  });

export const checkSessionAction = getAuth;
export const getAuthAction = getAuth;
export const refreshAuthAction = getAuth;
export const getAccessTokenAction = getAuth;
export const refreshAccessTokenAction = getAuth;
export const switchToOrganizationAction = switchToOrganization;
export const getOrganizationAction = getAuth;

export function handleCallbackRoute() {
  return async ({ request }: { request: Request }) => {
    const { previewCallback } = await import("./session.server");
    return previewCallback(request);
  };
}
