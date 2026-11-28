import type { NetworkRule } from "./platform-store";

/** Rules sorted for display: allows first, then blocks, each by pattern. */
export function sortRules(rules: readonly NetworkRule[]): NetworkRule[] {
  return [...rules].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "allow" ? -1 : 1;
    return a.pattern.localeCompare(b.pattern);
  });
}

// The API's pattern: an exact host or "*.example.com", lowercase, no path.
const PATTERN =
  /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A host, or a `*.` wildcard host. */
export function validatePattern(value: string): string | null {
  const pattern = value.trim().toLowerCase();
  if (!pattern) return "Enter a host, like api.github.com or *.example.com.";
  if (/^https?:\/\//.test(pattern)) {
    return "Leave off the scheme: api.github.com, not https://api.github.com.";
  }
  if (!PATTERN.test(pattern)) {
    return "Use a host like api.github.com, or *.example.com for every subdomain.";
  }
  return null;
}
