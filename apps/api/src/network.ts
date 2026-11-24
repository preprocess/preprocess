// The network guardrail (spec 5): organization rules, per-agent rules that only
// narrow them, and the effective rules a deployment's outbound Worker applies.
// Patterns are the outbound Worker's: an exact host or "*.example.com".

import type { Tx } from "@preprocess/db/client";
import {
  agentNetworkRules,
  organizationGuardrails,
} from "@preprocess/db/schema/guardrails";
import type { NetworkRules } from "@preprocess/db/schema/guardrails";
import { eq } from "drizzle-orm";

export type { NetworkRules };

export const OPEN: NetworkRules = { allow: [], block: [] };

// An allow list no host matches: an agent whose allow list shares nothing with
// the organization's may reach no host at all.
export const NO_HOST = ".none";

export const NETWORK_PATTERN =
  /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const within = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

// Whether every host `q` matches is matched by `p`.
export const covers = (p: string, q: string) => {
  if (!p.startsWith("*.")) return p === q;
  const domain = p.slice(2);
  return within(q.startsWith("*.") ? q.slice(2) : q, domain);
};

// Whether a host, or every host a pattern matches, may be reached.
export const permits = (rules: NetworkRules, pattern: string) =>
  !rules.block.some((b) => covers(b, pattern) || covers(pattern, b)) &&
  (rules.allow.length === 0 || rules.allow.some((a) => covers(a, pattern)));

const unique = (patterns: string[]) => [...new Set(patterns)].sort();

// The organization's rules narrowed by the agent's: both block lists, and the
// allow patterns both lists accept.
export const narrow = (
  org: NetworkRules,
  agent: NetworkRules | undefined,
): NetworkRules => {
  if (!agent) return org;
  const block = unique([...org.block, ...agent.block]);
  if (agent.allow.length === 0) return { allow: org.allow, block };
  if (org.allow.length === 0) return { allow: unique(agent.allow), block };
  const allow = unique(
    org.allow.flatMap((o) =>
      agent.allow.flatMap((a) =>
        covers(o, a) ? [a] : covers(a, o) ? [o] : [],
      ),
    ),
  );
  return { allow: allow.length ? allow : [NO_HOST], block };
};

// Whether `after` lets through a host `before` stopped.
export const loosens = (before: NetworkRules, after: NetworkRules) =>
  before.block.some((b) => !after.block.some((a) => covers(a, b))) ||
  (before.allow.length > 0 &&
    (after.allow.length === 0 ||
      after.allow.some((a) => !before.allow.some((b) => covers(b, a)))));

// The rules with `hosts` let through: block patterns that stop a host are
// dropped, and a non-empty allow list gains the host.
export const opening = (rules: NetworkRules, hosts: string[]): NetworkRules => {
  const stops = (b: string) => hosts.some((h) => covers(b, h) || covers(h, b));
  const allow = rules.allow.filter((a) => a !== NO_HOST);
  return {
    allow:
      rules.allow.length === 0
        ? []
        : unique([
            ...allow,
            ...hosts.filter((h) => !allow.some((a) => covers(a, h))),
          ]),
    block: rules.block.filter((b) => !stops(b)),
  };
};

export const organizationNetwork = async (tx: Tx) => {
  const [row] = await tx
    .select({ network: organizationGuardrails.network })
    .from(organizationGuardrails);
  return row?.network ?? OPEN;
};

export const agentNetwork = async (tx: Tx, agentId: string) => {
  const [row] = await tx
    .select({ rules: agentNetworkRules.rules })
    .from(agentNetworkRules)
    .where(eq(agentNetworkRules.agentId, agentId));
  return row?.rules;
};

export const effectiveNetwork = async (tx: Tx, agentId: string) =>
  narrow(await organizationNetwork(tx), await agentNetwork(tx, agentId));
