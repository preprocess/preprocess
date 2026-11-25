/**
 * Routes that render without the product shell or an organization: Better
 * Auth's API, sign-in and sign-up, and accepting an invitation (which loads
 * the session itself, so a signed-out invitee can choose to sign in or up).
 */
export function isPublicAuthPath(pathname: string) {
  return (
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/invitations/")
  );
}
