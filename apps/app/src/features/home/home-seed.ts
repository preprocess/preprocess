import type { ScenarioState } from "../../scenarios/scenarios";
import type { InboxItem } from "../inbox/notification";
import type { ApiHomeCard, HomeData } from "./home-api";

// Seeded home personas for development and renders (PRE-178). Each is what
// GET /home and the inbox would answer for that person.

export type HomeScenario = Exclude<ScenarioState<"home">, "live" | "loading">;

const NOW = Date.parse("2026-11-28T17:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const card = (
  name: ApiHomeCard["card"],
  kind: ApiHomeCard["kind"],
  fields: Partial<ApiHomeCard> = {},
): ApiHomeCard => ({
  id: name,
  card: name,
  kind,
  agent: null,
  name: null,
  count: null,
  at: null,
  ...fields,
});

const ROLES = {
  owner: {
    owner: true,
    admin: false,
    developer: false,
    operator: false,
    viewer: false,
  },
  developer: {
    owner: false,
    admin: false,
    developer: true,
    operator: false,
    viewer: false,
  },
  operator: {
    owner: false,
    admin: false,
    developer: false,
    operator: true,
    viewer: false,
  },
  viewer: {
    owner: false,
    admin: false,
    developer: false,
    operator: false,
    viewer: true,
  },
} as const;

const AGENTS: NonNullable<HomeData["agents"]> = {
  total: 6,
  items: [
    { slug: "claims-intake", status: "ready", live: true },
    { slug: "invoice-matching", status: "failed", live: true },
    { slug: "kyc-review", status: "building", live: true },
    { slug: "supplier-onboarding", status: "waiting", live: false },
  ],
};

const CASES: NonNullable<HomeData["cases"]> = {
  items: [
    {
      id: "case_01",
      agent: { id: "a1", slug: "claims-intake" },
      title: "Claim 48213",
      status: "waiting",
      updatedAt: ago(4),
    },
    {
      id: "case_02",
      agent: { id: "a2", slug: "invoice-matching" },
      title: "Invoice INV-2291",
      status: "running",
      updatedAt: ago(11),
    },
    {
      id: "case_03",
      agent: { id: "a3", slug: "kyc-review" },
      title: "Account 7734",
      status: "completed",
      updatedAt: ago(38),
    },
    {
      id: "case_04",
      agent: { id: "a1", slug: "claims-intake" },
      title: "Claim 48207",
      status: "failed",
      updatedAt: ago(52),
    },
  ],
};

const ACTIVITY: NonNullable<HomeData["activity"]> = {
  since: ago(24 * 60),
  hours: Array.from({ length: 24 }, (_, hour) => {
    const day = Math.max(0, Math.sin(((hour - 6) / 24) * Math.PI * 2));
    const started = Math.round(4 + day * 22 + (hour % 3));
    return {
      started,
      done: Math.max(0, started - 2 - (hour % 2)),
      failed: hour % 7 === 3 ? 3 : hour % 5 === 0 ? 1 : 0,
    };
  }),
};

const MEMBERS: NonNullable<HomeData["members"]> = {
  count: 14,
  groups: 4,
  seats: { used: 9, limit: 10 },
  people: [
    { id: "user_ada", name: "Ada Park", image: null },
    { id: "user_theo", name: "Theo Grant", image: null },
    { id: "user_mina", name: "Mina Okafor", image: null },
    { id: "user_luis", name: "Luis Romero", image: null },
    { id: "user_jo", name: "Jo Becker", image: null },
  ],
};

const EMPTY_ACTIVITY: NonNullable<HomeData["activity"]> = {
  since: ago(24 * 60),
  hours: Array.from({ length: 24 }, () => ({ started: 0, done: 0, failed: 0 })),
};

const caseItem = (
  id: string,
  kind: InboxItem["kind"],
  title: string,
  minutes: number,
  slug = "claims-intake",
): InboxItem => ({
  id,
  kind,
  title,
  summary: "",
  body: "",
  createdAt: ago(minutes),
  unread: true,
  link: { kind: "case", agentId: slug, caseId: `case_${id}` },
});

const WAITING: readonly InboxItem[] = [
  caseItem("w1", "case-update", "Claim 48213", 190),
  {
    ...caseItem(
      "w2",
      "approval",
      "Approve send_payment",
      120,
      "invoice-matching",
    ),
    details: [{ label: "Tool", value: "send_payment" }],
  },
  caseItem("w3", "mention", "Claims team was mentioned", 75),
  caseItem("w4", "memory", "Memory proposal", 40, "kyc-review"),
  caseItem("w5", "review", "Account 7734", 22, "kyc-review"),
  caseItem("w6", "case-update", "Claim 48219", 9),
];

const empty = (roles: HomeData["roles"]): HomeData => ({
  roles,
  cards: [],
  dismissed: [],
  agents: null,
  cases: null,
  activity: null,
  members: null,
});

export function seededHome(state: HomeScenario): {
  home: HomeData;
  waiting: readonly InboxItem[];
} {
  switch (state) {
    case "new-owner":
      return {
        home: {
          ...empty(ROLES.owner),
          cards: [
            card("deploy-first-agent", "setup"),
            card("invite-team", "setup"),
            card("create-group", "setup"),
            card("set-up-sso", "setup"),
          ],
          agents: { total: 0, items: [] },
          cases: { items: [] },
          activity: EMPTY_ACTIVITY,
          members: {
            count: 1,
            groups: 0,
            seats: { used: 1, limit: 3 },
            people: [MEMBERS.people[0]],
          },
        },
        waiting: [],
      };
    case "owner":
      return {
        home: {
          ...empty(ROLES.owner),
          cards: [card("review-invitations", "broken", { count: 2 })],
          agents: AGENTS,
          cases: CASES,
          activity: ACTIVITY,
          members: MEMBERS,
        },
        waiting: [
          {
            id: "g1",
            kind: "guardrail",
            title: "Guardrail change requested",
            summary: "",
            body: "",
            createdAt: ago(55),
            unread: true,
            link: {
              kind: "guardrail",
              requestId: "gr_1",
              agentSlug: "invoice-matching",
            },
          },
        ],
      };
    case "new-developer":
      return {
        home: {
          ...empty(ROLES.developer),
          cards: [
            card("install-cli", "setup"),
            card("deploy-template", "setup"),
            card("run-test-case", "setup"),
            card("connect-mcp", "setup"),
            card("link-repository", "setup"),
          ],
          agents: { total: 0, items: [] },
          cases: { items: [] },
          activity: EMPTY_ACTIVITY,
        },
        waiting: [],
      };
    case "developer":
      return {
        home: {
          ...empty(ROLES.developer),
          cards: [
            card("fix-failed-deploy", "broken", {
              id: "fix-failed-deploy:a2",
              agent: { id: "a2", slug: "invoice-matching" },
            }),
            card("reconnect-mcp", "broken", {
              id: "reconnect-mcp:salesforce",
              name: "salesforce",
            }),
            card("add-missing-secret", "broken", {
              id: "add-missing-secret:a4",
              agent: { id: "a4", slug: "supplier-onboarding" },
              name: "SAP_API_KEY",
            }),
            card("review-failed-cases", "broken", { count: 7 }),
            card("review-eval-regression", "broken", {
              id: "review-eval-regression:a3",
              agent: { id: "a3", slug: "kyc-review" },
            }),
          ],
          agents: AGENTS,
          cases: CASES,
          activity: ACTIVITY,
        },
        waiting: [],
      };
    case "new-operator":
      return {
        home: {
          ...empty(ROLES.operator),
          cards: [card("open-first-case", "setup")],
          cases: { items: CASES.items.slice(0, 3) },
        },
        waiting: WAITING.slice(0, 2),
      };
    case "operator":
      return {
        home: { ...empty(ROLES.operator), cases: CASES },
        waiting: WAITING,
      };
    case "viewer":
      return {
        home: {
          ...empty(ROLES.viewer),
          cases: { items: CASES.items.slice(0, 3) },
        },
        waiting: [],
      };
    case "multi-role":
      return {
        home: {
          roles: {
            owner: true,
            admin: false,
            developer: true,
            operator: true,
            viewer: false,
          },
          dismissed: [],
          cards: [
            card("fix-failed-deploy", "broken", {
              id: "fix-failed-deploy:a2",
              agent: { id: "a2", slug: "invoice-matching" },
            }),
            card("review-failed-cases", "broken", { count: 1 }),
            card("connect-mcp", "setup"),
          ],
          agents: AGENTS,
          cases: CASES,
          activity: ACTIVITY,
          members: MEMBERS,
        },
        waiting: WAITING.slice(0, 2),
      };
    case "empty":
      return {
        home: {
          roles: {
            owner: true,
            admin: false,
            developer: true,
            operator: true,
            viewer: false,
          },
          cards: [],
          dismissed: [],
          agents: { total: 0, items: [] },
          cases: { items: [] },
          activity: EMPTY_ACTIVITY,
          members: {
            count: 1,
            groups: 0,
            seats: { used: 1, limit: null },
            people: [MEMBERS.people[0]],
          },
        },
        waiting: [],
      };
  }
}
