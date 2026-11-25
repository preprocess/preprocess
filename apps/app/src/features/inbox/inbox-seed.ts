import type { ScenarioState } from "../../scenarios/scenarios";
import {
  INBOX_AGENT_LINK_ITEM,
  INBOX_LONG_COPY_ITEM,
  INBOX_NOTE_ONLY_ITEM,
  INBOX_SINGLE_UNREAD_ITEMS,
  INBOX_TEST_ITEMS,
  withInboxRead,
} from "./inbox-test-items";
import {
  unreadCount,
  type InboxCounts,
  type InboxItem,
  type InboxPage,
  type MarkReadSelector,
} from "./notification";

/** The seeded states; "live" reads the API instead. */
export type InboxScenario = Exclude<ScenarioState<"inbox">, "live">;

export type InboxLoad = InboxPage & { readonly loadError: boolean };

const SEEDED_ITEMS: readonly InboxItem[] = [
  INBOX_AGENT_LINK_ITEM,
  ...INBOX_TEST_ITEMS,
  INBOX_NOTE_ONLY_ITEM,
];

function seedItems(scenario: InboxScenario): readonly InboxItem[] {
  switch (scenario) {
    case "seeded":
      return SEEDED_ITEMS;
    case "all-read":
      return withInboxRead(SEEDED_ITEMS);
    case "single-unread":
      return INBOX_SINGLE_UNREAD_ITEMS;
    case "long-copy":
      return [INBOX_LONG_COPY_ITEM, ...INBOX_SINGLE_UNREAD_ITEMS];
    case "empty":
      return [];
    default: {
      const exhaustive: never = scenario;
      return exhaustive;
    }
  }
}

/**
 * In-memory mailbox per scenario. Reads stick until the dev server restarts
 * or the store is reset. There is no inbox backend yet.
 */
export function createInboxStore() {
  const readIds = new Map<InboxScenario, Set<string>>();

  function readSet(scenario: InboxScenario) {
    let set = readIds.get(scenario);
    if (!set) {
      set = new Set();
      readIds.set(scenario, set);
    }
    return set;
  }

  function items(scenario: InboxScenario): readonly InboxItem[] {
    const read = readSet(scenario);
    return seedItems(scenario).map((item) =>
      item.unread && read.has(item.id) ? { ...item, unread: false } : item,
    );
  }

  return {
    load(scenario: InboxScenario, now = new Date()): InboxLoad {
      const current = items(scenario);
      return {
        items: current,
        unreadCount: unreadCount(current),
        nextCursor: null,
        asOf: now.toISOString(),
        loadError: false,
      };
    },
    markRead(scenario: InboxScenario, selector: MarkReadSelector): InboxCounts {
      const asOf = selector.kind === "all" ? Date.parse(selector.asOf) : 0;
      const read = readSet(scenario);
      let changed = 0;
      for (const item of items(scenario)) {
        const selected =
          selector.kind === "items"
            ? selector.ids.includes(item.id)
            : Date.parse(item.createdAt) <= asOf;
        if (!selected || !item.unread) continue;
        read.add(item.id);
        changed += 1;
      }
      return { unreadCount: unreadCount(items(scenario)), changed };
    },
    reset() {
      readIds.clear();
    },
  };
}
