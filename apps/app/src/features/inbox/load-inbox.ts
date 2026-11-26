import { currentScenario } from "../../scenarios/current-scenario";
import type { Case } from "../agent-cases/case";
import { getOrgCase } from "../agent-cases/list-org-cases";
import { liveInboxPage, loadApiInbox, markApiInboxRead } from "./inbox-api";
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

/** The inbox page: the inbox and the cases its items link to. */
export async function loadInboxPage(): Promise<InboxLoad & { cases: Case[] }> {
  const scenario = currentScenario();
  if (scenario.inbox === "live" && scenario.cases === "live")
    return liveInboxPage();
  const page = await loadInbox();
  const linked = await Promise.all(
    page.items.flatMap((item) =>
      item.link?.kind === "case"
        ? [getOrgCase(item.link.agentId, item.link.caseId)]
        : [],
    ),
  );
  return { ...page, cases: linked.filter((item) => item !== null) };
}

export function markInboxRead(
  selector: MarkReadSelector,
): Promise<InboxCounts> {
  const scenario = currentScenario().inbox;
  if (scenario === "live") return markApiInboxRead({ data: selector });
  return Promise.resolve(inboxStore.markRead(scenario, selector));
}
