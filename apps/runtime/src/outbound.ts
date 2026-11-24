import { WorkerEntrypoint } from "cloudflare:workers";

import type { Env, NetworkRules } from "./env.ts";

// The gateway for every fetch() and connect() an agent's code makes: the
// loader passes it as the Dynamic Worker's globalOutbound (design doc 03), so
// the organization's network rules (spec 5 and 15) apply where customer code
// cannot reach them. Bindings (MCP) are trusted channels and do not pass
// through here.

export type OutboundProps = { organizationId: string; network: NetworkRules };

const matches = (host: string, pattern: string) =>
  pattern.startsWith("*.")
    ? host === pattern.slice(2) || host.endsWith(pattern.slice(1))
    : host === pattern;

export const allowed = (host: string, rules: NetworkRules) =>
  !rules.block.some((pattern) => matches(host, pattern)) &&
  (rules.allow.length === 0 ||
    rules.allow.some((pattern) => matches(host, pattern)));

export class Outbound extends WorkerEntrypoint<Env, OutboundProps> {
  override fetch(request: Request) {
    const host = new URL(request.url).hostname.toLowerCase();
    if (allowed(host, this.ctx.props.network)) return fetch(request);
    return Response.json(
      {
        error: "blocked_by_network_rules",
        host,
        organizationId: this.ctx.props.organizationId,
      },
      { status: 403 },
    );
  }
}
