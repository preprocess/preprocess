import { currentScenario } from "../../scenarios/current-scenario";
import { createInboxStore, type InboxLoad } from "./inbox-seed";
import type { InboxCounts, MarkReadSelector } from "./notification";

export type { InboxLoad } from "./inbox-seed";

// Seeded records are a development aid; builds outside dev get the empty
// scenario. The store lives per runtime (server render and browser), so
// reads reset on a full page load. Swap these for API calls when the backend
// lands.
const inboxStore = createInboxStore();

export function resetInboxStore() {
  inboxStore.reset();
}

export function loadInbox(): Promise<InboxLoad> {
  return Promise.resolve(inboxStore.load(currentScenario().inbox));
}

export function markInboxRead(
  selector: MarkReadSelector,
): Promise<InboxCounts> {
  return Promise.resolve(
    inboxStore.markRead(currentScenario().inbox, selector),
  );
}
