import type { InboxItem } from "./notification";

export const INBOX_AGENT_ITEM: InboxItem = {
  id: "ntf_vendor_digest",
  title: "Acme vendor diligence",
  summary: "Agent finished a new review pass",
  body: "Intake finished extracting counterparties and flagged two missing exhibits. Open the case to confirm the findings before they go to review.",
  kind: "agent",
  createdAt: "2026-08-19T10:24:00.000Z",
  unread: true,
  link: { kind: "case", caseId: "cas_7f3a2b1c9e04", agentId: "lab" },
};

export const INBOX_MENTION_ITEM: InboxItem = {
  id: "ntf_mention_ada",
  title: "Ada mentioned you",
  summary: "On Q3 inbound contracts",
  body: "Ada asked you to look at the indemnity clause in the latest inbound pack. She left the note on the questionnaire file.",
  kind: "mention",
  createdAt: "2026-08-19T10:15:00.000Z",
  unread: true,
  link: { kind: "case", caseId: "cas_intake_01", agentId: "intake" },
};

export const INBOX_ASSIGNMENT_ITEM: InboxItem = {
  id: "ntf_assigned_review",
  title: "You were assigned",
  summary: "Q3 inbound contracts",
  body: "This case is waiting on a human review. The agent already staged the extracted terms and open questions.",
  kind: "assignment",
  createdAt: "2026-08-19T09:40:00.000Z",
  unread: true,
  link: { kind: "case", caseId: "cas_intake_01", agentId: "intake" },
};

export const INBOX_CASE_UPDATE_ITEM: InboxItem = {
  id: "ntf_case_waiting",
  title: "Acme vendor diligence",
  summary: "Case moved to waiting",
  body: "The case is waiting on an external reply. You will get another notification when the agent has something new to show.",
  kind: "case-update",
  createdAt: "2026-08-19T08:10:00.000Z",
  unread: false,
  link: { kind: "case", caseId: "cas_7f3a2b1c9e04", agentId: "lab" },
};

export const INBOX_OVERDUE_ITEM: InboxItem = {
  id: "ntf_overdue_exhibits",
  title: "Missing exhibits are overdue",
  summary: "Acme vendor diligence",
  body: "Two requested exhibits have passed the follow-up window. Confirm whether to nudge the vendor or close those asks.",
  kind: "overdue",
  createdAt: "2026-08-18T16:00:00.000Z",
  unread: true,
  link: { kind: "case", caseId: "cas_7f3a2b1c9e04", agentId: "lab" },
};

export const INBOX_APPROVAL_ITEM: InboxItem = {
  id: "ntf_approval_payment",
  title: "Acme vendor diligence",
  summary: "Approve the pay_invoice tool call",
  body: "The invoice total is over the payment limit set for this agent.",
  kind: "approval",
  createdAt: "2026-08-19T10:28:00.000Z",
  unread: true,
  link: { kind: "case", caseId: "cas_7f3a2b1c9e04", agentId: "lab" },
  details: [
    { label: "Approves", value: "Finance" },
    { label: "Tool", value: "pay_invoice" },
    {
      label: "Request",
      value: '{\n  "amount": 12400,\n  "currency": "USD"\n}',
    },
  ],
};

export const INBOX_GUARDRAIL_ITEM: InboxItem = {
  id: "ntf_guardrail_network",
  title: "Guardrail request",
  summary: "Let lab reach erp.example.com",
  body: "The ERP moved to a new host and the agent can no longer look up vendors.",
  kind: "guardrail",
  createdAt: "2026-08-19T10:20:00.000Z",
  unread: true,
  link: { kind: "guardrail", agentId: "lab" },
  details: [
    { label: "Agent", value: "lab" },
    { label: "Hosts", value: "erp.example.com" },
  ],
};

export const INBOX_TEST_ITEMS: readonly InboxItem[] = [
  INBOX_APPROVAL_ITEM,
  INBOX_AGENT_ITEM,
  INBOX_GUARDRAIL_ITEM,
  INBOX_MENTION_ITEM,
  INBOX_ASSIGNMENT_ITEM,
  INBOX_CASE_UPDATE_ITEM,
  INBOX_OVERDUE_ITEM,
];

export const INBOX_AGENT_LINK_ITEM: InboxItem = {
  id: "ntf_agent_ready",
  title: "Intake agent is ready",
  summary: "No case to open yet",
  body: "The intake agent finished warming up. This notice links to the agent, not a case.",
  kind: "agent",
  createdAt: "2026-08-19T10:30:00.000Z",
  unread: true,
  link: { kind: "agent", agentId: "intake" },
};

export const INBOX_NOTE_ONLY_ITEM: InboxItem = {
  id: "ntf_system_note",
  title: "Organization digest",
  summary: "Weekly summary",
  body: "Five cases moved this week. There is no case or agent link on this note.",
  kind: "case-update",
  createdAt: "2026-08-19T07:00:00.000Z",
  unread: false,
};

export const INBOX_LONG_COPY_ITEM: InboxItem = {
  id: "ntf_long_copy",
  title:
    "Ada mentioned you on a very long indemnity discussion that should truncate in the list",
  summary:
    "A summary that is also long enough to overflow the list row and prove truncation",
  body: "This body is meant to wrap in the viewer. Confirm the list still truncates the title and summary, and that the issued time stays on one line next to the unread mark.",
  kind: "mention",
  createdAt: "2026-08-12T09:00:00.000Z",
  unread: true,
  link: { kind: "case", caseId: "cas_intake_01", agentId: "intake" },
};

export const INBOX_SINGLE_UNREAD_ITEMS: readonly InboxItem[] = [
  INBOX_MENTION_ITEM,
  INBOX_CASE_UPDATE_ITEM,
];

export function withInboxRead(
  items: readonly InboxItem[],
): readonly InboxItem[] {
  return items.map((item) => ({ ...item, unread: false }));
}
