// The Directory sync page's types (GET /v1/orgs/{org}/scim, PRE-138) and its
// seeded states, one per Design frame.

import type { ScenarioState } from "../../scenarios/scenarios";
import type { NamingDeployment } from "../groups/cant-delete-group";

export type ScimCurrentToken = {
  prefix: string;
  status: "active";
  last4: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  lastUsedAt: string | null;
  expiresAt: string;
};

export type ScimGroup = {
  id: string;
  slug: string;
  name: string;
  memberCount: number;
  removedAt: string | null;
  removedMembers: number | null;
  agents: number | null;
};

export type DirectorySync = {
  allowed: boolean;
  reason: "plan" | "license_missing" | "license_expired" | null;
  license: {
    status: "active" | "grace" | "expired";
    expiresAt: string;
    graceEndsAt: string;
  } | null;
  canEdit: boolean;
  baseUrl: string;
  lastSyncAt: string | null;
  token: ScimCurrentToken | null;
  sync: {
    running: boolean;
    received: number | null;
    people: { synced: number; deactivated: number };
  };
  groups: ScimGroup[];
};

/** A synced group the identity provider removed (GET /scim/removed-groups). */
export type RemovedGroup = {
  id: string;
  slug: string;
  name: string;
  removedAt: string;
  agents: number;
};

/** The page's settings and who reads them; GET /scim doesn't name the role. */
export type DirectorySyncView = {
  settings: DirectorySync;
  role: "owner" | "admin";
};

export type DirectorySyncSeedState = Exclude<
  ScenarioState<"directory-sync">,
  "live"
>;

const APP = "https://app.preprocess.com";

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const group = (
  name: string,
  memberCount: number,
  removed?: { at: string; people: number; agents: number },
): ScimGroup => ({
  id: `grp_${name.toLowerCase().replaceAll(" ", "_")}`,
  slug: name.toLowerCase().replaceAll(" ", "-"),
  name,
  memberCount,
  removedAt: removed?.at ?? null,
  removedMembers: removed?.people ?? null,
  agents: removed?.agents ?? null,
});

const GROUPS: ScimGroup[] = [
  group("Claims team", 17),
  group("Developers", 9),
  group("Everyone", 128),
  group("Finance reviewers", 6),
  group("Operators", 42),
];

/** Live deployments naming each seeded group, as GET /groups/{group} lists them. */
export const SEEDED_NAMED_BY: Record<string, NamingDeployment[]> = {
  grp_contractors: [
    { agentSlug: "claims-intake", environment: "production" },
    { agentSlug: "payouts", environment: "production" },
  ],
};

/** The token the seeded token-created state shows once. */
export const SEEDED_SECRET = "scim_4Qz8Lm2VtR9xK7aP1wE6nB3cY5hJ0a91f";

const TOKEN: ScimCurrentToken = {
  prefix: "ba_scim_credential_seeded",
  status: "active",
  last4: "a91f",
  createdAt: "2026-11-20T17:40:00.000Z",
  createdBy: { id: "user_dana", name: "Dana Whitfield" },
  lastUsedAt: minutesAgo(4),
  expiresAt: "2027-11-20T17:40:00.000Z",
};

const SYNCED: DirectorySync = {
  allowed: true,
  reason: null,
  license: null,
  canEdit: true,
  baseUrl: `${APP}/api/auth/scim/v2`,
  lastSyncAt: minutesAgo(4),
  token: TOKEN,
  sync: {
    running: false,
    received: null,
    people: { synced: 128, deactivated: 3 },
  },
  groups: GROUPS,
};

const NEVER: DirectorySync = {
  ...SYNCED,
  lastSyncAt: null,
  token: null,
  sync: {
    running: false,
    received: null,
    people: { synced: 0, deactivated: 0 },
  },
  groups: [],
};

const LOCKED: DirectorySync = {
  ...NEVER,
  allowed: false,
  reason: "plan",
  canEdit: false,
};

export function seededDirectorySync(
  state: Exclude<DirectorySyncSeedState, "member" | "loading" | "error">,
): DirectorySyncView {
  const owner = (settings: DirectorySync): DirectorySyncView => ({
    settings,
    role: "owner",
  });
  switch (state) {
    case "never":
      return owner(NEVER);
    case "synced":
    case "token-created":
    case "regenerate":
    case "revoke":
      return owner(SYNCED);
    case "syncing":
      return owner({
        ...SYNCED,
        lastSyncAt: minutesAgo(0),
        sync: { ...SYNCED.sync, running: true, received: 46 },
      });
    case "group-removed":
      return owner({
        ...SYNCED,
        groups: [
          ...GROUPS,
          group("Contractors", 0, {
            at: "2026-11-27T15:10:00.000Z",
            people: 9,
            agents: 2,
          }),
        ],
      });
    case "admin":
      return { settings: { ...SYNCED, canEdit: false }, role: "admin" };
    case "expired":
      return owner({
        ...SYNCED,
        allowed: false,
        reason: "license_expired",
        canEdit: false,
        license: {
          status: "expired",
          expiresAt: "2026-10-02T00:00:00.000Z",
          graceEndsAt: "2026-11-01T00:00:00.000Z",
        },
        lastSyncAt: "2026-11-01T00:00:00.000Z",
        token: { ...TOKEN, lastUsedAt: "2026-11-01T00:00:00.000Z" },
      });
    case "locked":
      return owner(LOCKED);
    case "locked-selfhost":
      return owner({ ...LOCKED, reason: "license_missing" });
  }
}
