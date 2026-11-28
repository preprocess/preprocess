const BASE = "https://app.invalid";

/**
 * A same-origin path to return to after signing in or onboarding, or "/".
 * Parsing as a URL catches what a prefix check misses: browsers read "/\\x"
 * as "//x" and drop tabs and newlines, so either can turn a path into
 * another host.
 */
export function safeRedirect(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  const url = new URL(value, BASE);
  return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : "/";
}
