import type { NetworkRule } from "./platform-store";

/** An organization rule as one agent sees it. */
export type InheritedRule = {
  readonly rule: NetworkRule;
  /** The agent's rule for the same pattern, when the agent overrides it. */
  readonly overriddenBy: NetworkRule | null;
};

/** One of the agent's own rules. */
export type AgentRule = {
  readonly rule: NetworkRule;
  /** The organization rule this one replaces, if any. */
  readonly overrides: NetworkRule | null;
};

/**
 * How an agent's rules sit on the organization's. An agent rule for a
 * pattern the organization also rules on overrides it; any other agent rule
 * is an addition. The agent's rule always wins for its pattern.
 */
export function agentNetworkView(
  organization: readonly NetworkRule[],
  agent: readonly NetworkRule[],
): { inherited: InheritedRule[]; own: AgentRule[]; overrideCount: number } {
  const agentByPattern = new Map(agent.map((rule) => [rule.pattern, rule]));
  const orgByPattern = new Map(
    organization.map((rule) => [rule.pattern, rule]),
  );
  const inherited = organization.map((rule) => ({
    rule,
    overriddenBy: agentByPattern.get(rule.pattern) ?? null,
  }));
  const own = agent.map((rule) => ({
    rule,
    overrides: orgByPattern.get(rule.pattern) ?? null,
  }));
  return {
    inherited,
    own,
    overrideCount: own.filter((item) => item.overrides !== null).length,
  };
}

/** Rules sorted for display: allows first, then blocks, each by pattern. */
export function sortRules<T extends { rule: NetworkRule } | NetworkRule>(
  rules: readonly T[],
): T[] {
  const ruleOf = (item: T): NetworkRule => ("rule" in item ? item.rule : item);
  return [...rules].sort((left, right) => {
    const a = ruleOf(left);
    const b = ruleOf(right);
    if (a.kind !== b.kind) return a.kind === "allow" ? -1 : 1;
    return a.pattern.localeCompare(b.pattern);
  });
}

const PATTERN = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}(\/[^\s]*)?$/i;

/** A host, a `*.` wildcard host, or either with a path. */
export function validatePattern(value: string): string | null {
  const pattern = value.trim();
  if (!pattern) return "Enter a host, like api.github.com or *.example.com.";
  if (/^https?:\/\//i.test(pattern)) {
    return "Leave off the scheme: api.github.com, not https://api.github.com.";
  }
  if (!PATTERN.test(pattern)) {
    return "Use a host like api.github.com, or *.example.com for every subdomain.";
  }
  return null;
}
