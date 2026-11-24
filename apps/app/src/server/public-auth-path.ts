/** AuthKit callback / sign-in / sign-out routes that must stay public. */
export function isPublicAuthPath(pathname: string) {
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

/**
 * Case room (`/cases/{agentId}/{caseId}`). AuthKit sign-in currently trips
 * PKCE cookie size limits on this path. The `/cases` inbox is not public.
 */
export function isPublicCasePath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  return segments[0] === "cases" && segments.length >= 3;
}
