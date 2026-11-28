// The help center at support.preprocess.com: a Worker of its own (TanStack
// Start, like apps/docs), not a route on the app.
//
// - It serves signed-out visitors publicly and caches like the docs.
// - It deploys and rolls back on its own, apart from the app.
// - It is hosted-only: selfhost stages don't deploy it. The app's Help menu
//   points a self-hosted install at our center for license holders, or at a
//   URL the customer sets, so no support data leaves their install.
// - It reuses the docs' Markdown pipeline (Fumadocs) and search
//   (@preprocess/search) instead of putting public content inside the
//   authenticated app's bundle.
//
// One wide event per request goes to PostHog where configured
// (@preprocess/logs).

import { withRequestEvents } from "@preprocess/logs";
import handler from "@tanstack/react-start/server-entry";

export default {
  fetch: withRequestEvents("support", (request: Request) =>
    handler.fetch(request),
  ),
};
