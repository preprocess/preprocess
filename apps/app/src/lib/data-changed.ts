// The router reuses loader data for a short while (defaultStaleTime) and
// React Query keeps settings for 30 s. Every write the browser makes marks
// both stale, so a change shows on the current page and on every page visited
// after it: non-GET API calls through apiFetch, and server functions that
// write, which take staleAfterWrite.

import { createMiddleware } from "@tanstack/react-start";

const CHANGED = "preprocess:data-changed";

export const announceDataChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
};

export const onDataChanged = (listener: () => void) => {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
};

export const staleAfterWrite = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const result = await next();
    announceDataChanged();
    return result;
  },
);
