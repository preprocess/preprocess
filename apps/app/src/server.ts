import { withRequestEvents } from "@preprocess/logs";
import handler from "@tanstack/react-start/server-entry";

// The app Worker: TanStack Start's handler, with one wide event per request
// for PostHog where configured (@preprocess/logs).
export default {
  fetch: withRequestEvents("app", (request: Request) => handler.fetch(request)),
};
