import type { ProductProperties } from "@preprocess/logs";

import { billingShown, type Billing } from "../billing/billing-types";
import type { InboxItem } from "../inbox/notification";
import type { ApiHomeCard, HomeData, SetupCard } from "./home-api";

// The "To do" row (PRE-178): what waits on the person, then what is broken,
// then first-time setup, at most four. Titles are Writing's (PLAT-82).

export type HomeCardName = ProductProperties<"home_card_clicked">["card"];

export type HomeCardView = {
  readonly id: string;
  readonly name: HomeCardName;
  readonly title: string;
  readonly line: string | null;
  /** Broken cards lead with a status dot. */
  readonly dot: "warning" | "danger" | null;
  readonly action:
    | { readonly kind: "link"; readonly label: string; readonly href: string }
    | { readonly kind: "copy"; readonly command: string };
  /** First-time cards can be dismissed. */
  readonly dismiss: SetupCard | null;
};

export const MAX_CARDS = 4;

const link = (label: string, href: string) =>
  ({ kind: "link", label, href }) as const;

const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : many.replace("{n}", String(count));

const enc = encodeURIComponent;

const caseHref = (item: InboxItem) =>
  item.link?.kind === "case"
    ? `/agents/${enc(item.link.agentId)}/cases/${enc(item.link.caseId)}`
    : `/inbox?item=${enc(item.id)}`;

const agentOf = (item: InboxItem) =>
  item.link?.kind === "case"
    ? item.link.agentId
    : item.link?.kind === "agent"
      ? item.link.agentId
      : null;

function waitingCard(item: InboxItem): HomeCardView {
  const base = { id: `inbox:${item.id}`, dot: null, dismiss: null };
  const open = link("Open case", caseHref(item));
  switch (item.kind) {
    case "approval": {
      const target = item.details?.find(
        (d) => d.label === "Tool" || d.label === "Field",
      )?.value;
      return {
        ...base,
        name: "approve_request",
        title: `Approve ${target ?? "case completion"}`,
        line: agentOf(item),
        action: open,
      };
    }
    case "guardrail":
      return {
        ...base,
        name: "approve_guardrail",
        title: "Approve guardrail change",
        line:
          item.link?.kind === "guardrail"
            ? (item.link.agentSlug ?? "All agents")
            : null,
        action: link("Review", `/inbox?item=${enc(item.id)}`),
      };
    case "mention":
      return {
        ...base,
        name: "reply_to_mention",
        title: `Reply to ${item.group ?? "your group"} mention`,
        line: agentOf(item),
        action: open,
      };
    case "memory":
      return {
        ...base,
        name: "review_memory",
        title: "Review memory proposal",
        line: agentOf(item),
        action: open,
      };
    default:
      return {
        ...base,
        name: "review_case",
        title: `Review ${(item.kind === "assignment" ? item.summary : item.title) || "Untitled case"}`,
        line: agentOf(item),
        action: open,
      };
  }
}

function apiCard(card: ApiHomeCard, origin: string): HomeCardView {
  const agent = card.agent?.slug ?? "";
  const base = {
    id: card.id,
    name: card.card.replaceAll("-", "_") as HomeCardName,
    line: null,
    dot: card.kind === "broken" ? ("warning" as const) : null,
    dismiss: card.kind === "setup" ? (card.card as SetupCard) : null,
  };
  switch (card.card) {
    case "fix-failed-deploy":
      return {
        ...base,
        dot: "danger",
        title: `Fix failed deploy on ${agent}`,
        action: link("Open deployments", `/agents/${enc(agent)}/deployments`),
      };
    case "reconnect-mcp":
      return {
        ...base,
        dot: "danger",
        title: `Reconnect ${card.name ?? ""}`,
        action: link("Reconnect", "/settings/organization/integrations"),
      };
    case "add-missing-secret":
      return {
        ...base,
        title: `Add missing secret ${card.name ?? ""}`,
        line: `Needed by ${agent}`,
        action: link("Add secret", "/settings/organization/secrets"),
      };
    case "review-failed-cases": {
      const count = card.count ?? 0;
      return {
        ...base,
        dot: "danger",
        title: plural(count, "Review 1 failed case", "Review {n} failed cases"),
        line: "Last 24 hours",
        action: link("Open cases", "/cases"),
      };
    }
    case "review-eval-regression":
      return {
        ...base,
        title: "Review evaluation regression",
        line: agent,
        action: link("Open evaluations", `/agents/${enc(agent)}/evaluations`),
      };
    case "fix-directory-sync":
      return {
        ...base,
        title: "Fix directory sync",
        line: plural(card.count ?? 0, "1 removed group", "{n} removed groups"),
        action: link("Review groups", "/settings/organization/directory-sync"),
      };
    case "renew-license": {
      const at = card.at ? new Date(card.at) : null;
      const when = at?.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return {
        ...base,
        dot: at && at.getTime() < Date.now() ? "danger" : "warning",
        title: "Renew license",
        line: when
          ? `${at!.getTime() < Date.now() ? "Expired" : "Expires"} ${when}`
          : null,
        action: link("Upload key", "/settings/organization/license"),
      };
    }
    case "review-invitations":
      return {
        ...base,
        dot: null,
        title: "Review pending invitations",
        line: `${card.count ?? 0} waiting`,
        action: link("Review", "/settings/organization/members"),
      };
    case "deploy-first-agent":
      return {
        ...base,
        title: "Deploy your first agent",
        action: link("Open agents", "/agents"),
      };
    case "invite-team":
      return {
        ...base,
        title: "Invite your team",
        action: link("Invite people", "/settings/organization/members"),
      };
    case "create-group":
      return {
        ...base,
        title: "Create a group",
        action: link("Create group", "/settings/organization/groups"),
      };
    case "add-payment-method":
      return {
        ...base,
        title: "Add a payment method",
        action: link("Add card", "/settings/organization/billing"),
      };
    case "set-up-sso":
      return {
        ...base,
        title: "Set up single sign-on",
        action: link("Set up SSO", "/settings/organization/sso"),
      };
    case "install-cli":
      return {
        ...base,
        title: "Install the CLI",
        action: {
          kind: "copy",
          command: `npm install -g @preprocess/cli && preprocess login --api ${origin}`,
        },
      };
    case "deploy-template":
      return {
        ...base,
        title: "Deploy a template agent",
        action: {
          kind: "copy",
          command:
            "preprocess init my-agent && cd my-agent && npm install && preprocess deploy",
        },
      };
    case "run-test-case":
      return {
        ...base,
        title: "Run a test case",
        action: link("Start a case", "/cases"),
      };
    case "connect-mcp":
      return {
        ...base,
        title: "Connect an MCP server",
        action: link("Add server", "/settings/organization/integrations"),
      };
    case "link-repository":
      return {
        ...base,
        title: "Link a repository",
        action: link("Connect GitHub", "/settings/organization/github"),
      };
    case "open-first-case":
      return {
        ...base,
        title: "Open your first case",
        action: link("Open cases", "/cases"),
      };
  }
}

const PAYMENT_CARD: ApiHomeCard = {
  id: "add-payment-method",
  card: "add-payment-method",
  kind: "setup",
  agent: null,
  name: null,
  count: null,
  at: null,
};

/**
 * Every card for the person, in order. Billing is undefined while it loads:
 * the payment cards wait for it, the rest don't.
 */
export function homeCards(
  home: HomeData,
  waiting: readonly InboxItem[],
  billing: Billing | null | undefined,
  origin: string,
): HomeCardView[] {
  const ownsBilling = home.roles.owner && billing && billingShown(billing);
  const paying =
    ownsBilling && billing.plan !== "enterprise" && billing.plan !== "internal";
  const broken = home.cards.filter((c) => c.kind === "broken");
  const setup = home.cards.filter((c) => c.kind === "setup");
  const needsCard =
    paying &&
    !billing.started &&
    !home.dismissed.includes("add-payment-method");

  const queued =
    waiting.length > MAX_CARDS
      ? [
          ...waiting.slice(0, MAX_CARDS - 1).map(waitingCard),
          {
            id: "inbox:all",
            name: "see_inbox",
            title: `See all ${waiting.length} in Inbox`,
            line: null,
            dot: null,
            action: link("Open Inbox", "/inbox"),
            dismiss: null,
          } satisfies HomeCardView,
        ]
      : waiting.map(waitingCard);

  return [
    ...queued,
    ...(ownsBilling && billing.pastDue
      ? [
          {
            id: "fix-failed-payment",
            name: "fix_failed_payment",
            title: "Fix failed payment",
            line: null,
            dot: "danger",
            action: link("Update card", "/settings/organization/billing"),
            dismiss: null,
          } satisfies HomeCardView,
        ]
      : []),
    ...broken.map((c) => apiCard(c, origin)),
    // The payment card goes where the spec lists it: before single sign-on.
    ...setup
      .flatMap((c) =>
        needsCard && c.card === "set-up-sso" ? [PAYMENT_CARD, c] : [c],
      )
      .concat(
        needsCard && !setup.some((c) => c.card === "set-up-sso")
          ? [PAYMENT_CARD]
          : [],
      )
      .map((c) => apiCard(c, origin)),
  ];
}
