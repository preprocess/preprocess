import { createFileRoute } from "@tanstack/react-router";

import { resetInboxStore } from "../../../features/inbox/load-inbox";
import {
  SCENARIO_COOKIE_NAME,
  SEEDED_SCENARIO,
  parseScenario,
  readCookie,
  serializeScenario,
} from "../../../scenarios/scenarios";

/**
 * Development-only scenario switch for scripts and agents:
 * `GET /api/dev/scenario?set=inbox:empty,cases:few&return=/inbox`.
 * `reset=1` clears the cookie and in-memory writes. 404 outside dev.
 */
function scenarioResponse(request: Request): Response {
  if (!import.meta.env.DEV) return new Response(null, { status: 404 });

  const url = new URL(request.url);
  const reset = url.searchParams.get("reset") === "1";
  if (reset) resetInboxStore();

  const current = reset
    ? SEEDED_SCENARIO
    : parseScenario(
        readCookie(request.headers.get("cookie"), SCENARIO_COOKIE_NAME),
      );
  const selection = parseScenario(url.searchParams.get("set"), current);
  const value = serializeScenario(selection);
  const cookie = value
    ? `${SCENARIO_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`
    : `${SCENARIO_COOKIE_NAME}=; Path=/; Max-Age=0`;

  const returnTo = url.searchParams.get("return");
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return new Response(null, {
      status: 303,
      headers: { location: returnTo, "set-cookie": cookie },
    });
  }
  return Response.json(selection, {
    headers: { "set-cookie": cookie, "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/dev/scenario")({
  server: {
    handlers: {
      GET: ({ request }) => scenarioResponse(request),
    },
  },
});
