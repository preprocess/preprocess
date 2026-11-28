import { withRequestEvents } from "@preprocess/logs";
import handler from "@tanstack/react-start/server-entry";

// The docs Worker: TanStack Start's handler, with one wide event per request
// for PostHog where configured (@preprocess/logs).
export default {
  fetch: withRequestEvents("docs", (request: Request) =>
    handler.fetch(request),
  ),
};
