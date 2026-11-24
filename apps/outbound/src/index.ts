import { WorkerEntrypoint } from "cloudflare:workers";

// The outbound Worker sees every fetch() an agent's deployed code makes
// (Workers for Platforms routes it here) and applies the organization's
// network rules (spec 5 and 15). The dispatching runtime passes the rules as
// outbound parameters, which reach this Worker as env values that customer
// code cannot set. Bindings (the MCP token service) are trusted channels and
// do not pass through here.

export type NetworkRules = { allow: string[]; block: string[] };

export type OutboundParams = { organizationId: string; network: string };

const matches = (host: string, pattern: string) =>
  pattern.startsWith("*.")
    ? host === pattern.slice(2) || host.endsWith(pattern.slice(1))
    : host === pattern;

export const allowed = (host: string, rules: NetworkRules) =>
  !rules.block.some((pattern) => matches(host, pattern)) &&
  (rules.allow.length === 0 ||
    rules.allow.some((pattern) => matches(host, pattern)));

const egress = (params: OutboundParams, request: Request) => {
  const host = new URL(request.url).hostname.toLowerCase();
  const rules = JSON.parse(params.network) as NetworkRules;
  if (allowed(host, rules)) return fetch(request);
  return Response.json(
    {
      error: "blocked_by_network_rules",
      host,
      organizationId: params.organizationId,
    },
    { status: 403 },
  );
};

// For Cloudflare's local runtime, which has no dispatch namespace: the local
// namespace Worker forwards each request with the parameters it was given.
export class Egress extends WorkerEntrypoint {
  fetchAs(params: OutboundParams, request: Request) {
    return egress(params, request);
  }
}

export default {
  fetch: (request, env) => egress(env, request),
} satisfies ExportedHandler<OutboundParams>;
