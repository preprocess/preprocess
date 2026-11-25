import { currentScenario } from "../../scenarios/current-scenario";
import { loadApiInbox, markApiInboxRead } from "./inbox-api";
import { createInboxStore, type InboxLoad } from "./inbox-seed";
import type { InboxCounts, MarkReadSelector } from "./notification";

export type { InboxLoad } from "./inbox-seed";

// The "live" scenario, and every build outside dev, read the API. The seeded
// scenarios are a development aid: their store lives per runtime (server
// render and browser), so reads reset on a full page load.
const inboxStore = createInboxStore();

export function resetInboxStore() {
  inboxStore.reset();
}

export function loadInbox(): Promise<InboxLoad> {
  const scenario = currentScenario().inbox;
  if (scenario === "live") return loadApiInbox();
  return Promise.resolve(inboxStore.load(scenario));
}

export function markInboxRead(
  selector: MarkReadSelector,
): Promise<InboxCounts> {
  const scenario = currentScenario().inbox;
  if (scenario === "live") return markApiInboxRead({ data: selector });
  return Promise.resolve(inboxStore.markRead(scenario, selector));
}
