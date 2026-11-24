import { createFileRoute, useRouter } from "@tanstack/react-router";

import type { Case } from "../features/agent-cases/case";
import { getOrgCase } from "../features/agent-cases/list-org-cases";
import { Inbox, inboxCaseKey } from "../features/inbox/inbox";
import { loadInbox, markInboxRead } from "../features/inbox/load-inbox";
import {
  parseInboxSearch,
  type InboxSearch,
} from "../features/inbox/notification";

export const Route = createFileRoute("/inbox")({
  staticData: { ownsHeader: true },
  validateSearch: (search: Record<string, unknown>): InboxSearch =>
    parseInboxSearch(search),
  loader: async () => {
    const page = await loadInbox();
    const linked = await Promise.all(
      page.items.flatMap((item) =>
        item.link?.kind === "case"
          ? [getOrgCase(item.link.agentId, item.link.caseId)]
          : [],
      ),
    );
    const cases: Record<string, Case> = {};
    for (const item of linked) {
      if (item) cases[inboxCaseKey(item.agentId, item.id)] = item;
    }
    return { ...page, cases };
  },
  component: InboxPage,
});

function InboxPage() {
  const page = Route.useLoaderData();
  const { item } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();

  return (
    <Inbox
      cases={page.cases}
      items={page.items}
      onMarkAllRead={() => {
        void markInboxRead({ kind: "all", asOf: page.asOf })
          .then(() => router.invalidate())
          .catch(() => undefined);
      }}
      onSelect={(next) => {
        void navigate({
          search: next ? { item: next } : {},
          replace: true,
        });
        const selected = page.items.find((entry) => entry.id === next);
        if (next && selected?.unread) {
          void markInboxRead({ kind: "items", ids: [next] })
            .then(() => router.invalidate())
            .catch(() => undefined);
        }
      }}
      selectedId={item}
    />
  );
}
