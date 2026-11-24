import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";
import type {
  NoUserInfo,
  User,
  UserInfo,
} from "@workos/authkit-tanstack-react-start";

import { PREVIEW_ORGANIZATION } from "./mode";

const SESSION_COOKIE = "preprocess-preview-session";

/**
 * Second lock behind vite.config.ts: even if this module reached a built
 * bundle, it refuses to run anywhere but the Vite dev server.
 */
export function isPreviewRuntime(): boolean {
  return import.meta.env.DEV;
}

export function safeReturnPath(value: string | null | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function readPreviewAuth(): UserInfo | NoUserInfo {
  if (!isPreviewRuntime()) {
    throw new Error("Preview sign-in only runs under `vite dev`.");
  }
  const email = getCookie(SESSION_COOKIE);
  if (!email) return { user: null };

  const now = new Date().toISOString();
  const user = {
    object: "user",
    id: "user_preview",
    email,
    emailVerified: true,
    firstName: "Preview",
    lastName: "User",
    profilePictureUrl: null,
    lastSignInAt: now,
    locale: null,
    externalId: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  } as User;
  return {
    user,
    sessionId: "session_preview",
    organizationId: PREVIEW_ORGANIZATION.id,
    role: "owner",
    roles: ["owner"],
    permissions: [],
    accessToken: "preview",
  };
}

export function endPreviewSession(): void {
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

/**
 * `/api/auth/callback`: a one-button page that starts the preview session,
 * then returns to where the visitor was headed.
 */
export function previewCallback(request: Request): Response {
  if (!isPreviewRuntime()) return new Response(null, { status: 404 });

  const url = new URL(request.url);
  const returnPathname = safeReturnPath(url.searchParams.get("returnPathname"));
  const email = "preview@preprocess.com";

  if (url.searchParams.get("continue") === "1") {
    setCookie(SESSION_COOKIE, email, {
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
    });
    return new Response(null, {
      status: 303,
      headers: { location: returnPathname },
    });
  }

  const next = `/api/auth/callback?continue=1&returnPathname=${encodeURIComponent(returnPathname)}`;
  const message =
    url.searchParams.get("signedOut") === "1"
      ? "You signed out of this preview."
      : "This preview runs on seeded scenarios. There is no backend and no WorkOS sign-in.";
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preprocess preview</title>
<body style="font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fafafa;color:#111">
<main style="max-width:24rem;padding:2rem;border:1px solid #e5e5e5;border-radius:12px;background:#fff">
<h1 style="font-size:17px;margin:0 0 .5rem">Preprocess preview</h1>
<p style="margin:0 0 1.25rem;color:#555">${message}</p>
<a href="${next}" style="display:inline-block;padding:.5rem .9rem;border-radius:999px;background:#111;color:#fff;text-decoration:none">Continue as ${escapeHtml(email)}</a>
</main></body>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
