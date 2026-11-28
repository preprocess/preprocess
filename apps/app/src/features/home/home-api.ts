import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";

import { currentScenario } from "../../scenarios/current-scenario";
import { orgApi } from "../auth/client";
import { loadInbox } from "../inbox/load-inbox";
import type { InboxItem } from "../inbox/notification";
import { seededHome } from "./home-seed";

// The home page's data (PRE-178): GET /v1/orgs/{org}/home for roles, cards
// and previews, and the inbox for what waits on the person. In development
// every "home" scenario but "live" is a seeded persona.

export const SETUP_CARDS = [
  "deploy-first-agent",
  "invite-team",
  "create-group",
  "add-payment-method",
  "set-up-sso",
  "install-cli",
  "deploy-template",
  "run-test-case",
  "connect-mcp",
  "link-repository",
  "open-first-case",
] as const;
export type SetupCard = (typeof SETUP_CARDS)[number];

export type BrokenCard =
  | "fix-failed-deploy"
  | "reconnect-mcp"
  | "add-missing-secret"
  | "review-failed-cases"
  | "review-eval-regression"
  | "fix-directory-sync"
  | "renew-license"
  | "review-invitations";

export type ApiHomeCard = {
  readonly id: string;
  readonly card: SetupCard | BrokenCard;
  readonly kind: "setup" | "broken";
  readonly agent: { readonly id: string; readonly slug: string } | null;
  readonly name: string | null;
  readonly count: number | null;
  readonly at: string | null;
};

export type DeploymentStatus = "ready" | "waiting" | "failed" | "building";

export type HomeData = {
  readonly roles: {
    readonly owner: boolean;
    readonly admin: boolean;
    readonly developer: boolean;
    readonly operator: boolean;
    readonly viewer: boolean;
  };
  readonly cards: readonly ApiHomeCard[];
  readonly dismissed: readonly SetupCard[];
  readonly agents: {
    readonly total: number;
    readonly items: readonly {
      readonly slug: string;
      readonly status: DeploymentStatus;
      readonly live: boolean;
    }[];
  } | null;
  readonly cases: {
    readonly items: readonly {
      readonly id: string;
      readonly agent: { readonly id: string; readonly slug: string };
      readonly title: string | null;
      readonly status: string;
      readonly updatedAt: string;
    }[];
  } | null;
  readonly activity: {
    readonly since: string;
    readonly hours: readonly {
      readonly started: number;
      readonly done: number;
      readonly failed: number;
    }[];
  } | null;
  readonly members: {
    readonly count: number;
    readonly groups: number;
    readonly seats: { readonly used: number; readonly limit: number | null };
    readonly people: readonly {
      readonly id: string;
      readonly name: string;
      readonly image: string | null;
    }[];
  } | null;
};

export type HomeLoad = {
  readonly home: HomeData;
  /** What waits on the person, oldest first. */
  readonly waiting: readonly InboxItem[];
};

const server = createServerOnlyFn(() => import("../../server/api.server"));

const liveHome = createServerFn({ method: "GET" }).handler(async () => {
  const { activeOrgJson } = await server();
  const [home, inbox] = await Promise.all([
    activeOrgJson<HomeData>("/home"),
    loadInbox(),
  ]);
  return { home, waiting: oldestFirst(inbox.items) };
});

const oldestFirst = (items: readonly InboxItem[]) =>
  [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

/** The person's home: the API's, or a seeded persona's. */
export function loadHome(): Promise<HomeLoad> {
  const state = currentScenario().home;
  if (state === "live" || state === "loading") return liveHome();
  const seed = seededHome(state);
  return Promise.resolve({ ...seed, waiting: oldestFirst(seed.waiting) });
}

/** People who only work cases start in the Inbox. */
export const landsOnInbox = ({ roles }: HomeData) =>
  roles.operator && !roles.owner && !roles.admin && !roles.developer;

export function dismissHomeCard(organizationId: string, card: SetupCard) {
  if (currentScenario().home !== "live") return Promise.resolve();
  return orgApi(organizationId, `/home/dismissed/${card}`, { method: "PUT" });
}
