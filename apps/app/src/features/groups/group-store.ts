import type { AgentAccessLevel } from "../agents/agent-seed";
import {
  setAgentAccess,
  storedAgents,
  type StoredAgent,
} from "../agents/agent-store";

/**
 * In-memory organization groups over a seed. A group stands for an
 * organization role: agent access is granted to groups, and a group synced
 * from the identity provider gets its members from there. The mapping from
 * identity-provider groups is set up in WorkOS's hosted Admin Portal, reached
 * from Authentication; here it is only shown. Changes stick until the dev
 * server restarts. There is no groups backend yet; builds outside dev serve
 * none.
 */

export type OrgPerson = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
};

export type GroupSource =
  | { readonly kind: "manual" }
  | {
      readonly kind: "directory";
      /** The identity provider, as Authentication names it. */
      readonly provider: string;
      /** The provider's groups mapped onto this one. */
      readonly idpGroups: readonly string[];
    };

export type OrgGroup = {
  readonly id: string;
  readonly name: string;
  readonly source: GroupSource;
  /** Built in: manages every agent rather than holding grants. */
  readonly managesAgents: boolean;
  readonly memberIds: readonly string[];
};

const PEOPLE: readonly OrgPerson[] = [
  { id: "usr_ada", name: "Ada Park", email: "ada@example.com" },
  { id: "usr_theo", name: "Theo Grant", email: "theo@example.com" },
  { id: "usr_mina", name: "Mina Okafor", email: "mina@example.com" },
  { id: "usr_jules", name: "Jules Moreau", email: "jules@example.com" },
  { id: "usr_priya", name: "Priya Raman", email: "priya@example.com" },
  { id: "usr_sam", name: "Sam Whitfield", email: "sam@example.com" },
  { id: "usr_lena", name: "Lena Brandt", email: "lena@example.com" },
  { id: "usr_omar", name: "Omar Haddad", email: "omar@example.com" },
  { id: "usr_grace", name: "Grace Liu", email: "grace@example.com" },
  { id: "usr_diego", name: "Diego Santos", email: "diego@example.com" },
  { id: "usr_noor", name: "Noor Aziz", email: "noor@example.com" },
  { id: "usr_ben", name: "Ben Carter", email: "ben@example.com" },
];

const OKTA = "Okta";

/** Developers first, then the rest by name, as the Groups tab lists them. */
const SEED: readonly OrgGroup[] = [
  {
    id: "developers",
    name: "Developers",
    source: { kind: "directory", provider: OKTA, idpGroups: ["eng-platform"] },
    managesAgents: true,
    memberIds: ["usr_theo", "usr_priya", "usr_omar"],
  },
  {
    id: "compliance",
    name: "Compliance",
    source: { kind: "manual" },
    managesAgents: false,
    memberIds: ["usr_lena"],
  },
  {
    id: "engineering",
    name: "Engineering",
    source: {
      kind: "directory",
      provider: OKTA,
      idpGroups: ["eng-all", "eng-contractors"],
    },
    managesAgents: false,
    memberIds: ["usr_theo", "usr_priya", "usr_omar", "usr_diego", "usr_ben"],
  },
  {
    id: "finance",
    name: "Finance",
    source: { kind: "directory", provider: OKTA, idpGroups: ["fin-ops"] },
    managesAgents: false,
    memberIds: ["usr_sam", "usr_grace", "usr_noor"],
  },
  {
    id: "legal",
    name: "Legal",
    source: { kind: "manual" },
    managesAgents: false,
    memberIds: ["usr_ada", "usr_lena"],
  },
  {
    id: "operations",
    name: "Operations",
    source: {
      kind: "directory",
      provider: OKTA,
      idpGroups: ["ops-leads", "ops-floor"],
    },
    managesAgents: false,
    memberIds: ["usr_mina", "usr_jules", "usr_sam", "usr_diego"],
  },
  {
    id: "sales",
    name: "Sales",
    source: { kind: "manual" },
    managesAgents: false,
    memberIds: ["usr_noor", "usr_ben"],
  },
  {
    id: "support",
    name: "Support",
    source: { kind: "directory", provider: OKTA, idpGroups: ["support"] },
    managesAgents: false,
    memberIds: ["usr_jules", "usr_grace"],
  },
];

let groups: Map<string, OrgGroup> | undefined;

function store(): Map<string, OrgGroup> {
  groups ??= new Map(
    (import.meta.env.DEV ? SEED : []).map((group) => [group.id, group]),
  );
  return groups;
}

function sorted(list: Iterable<OrgGroup>): OrgGroup[] {
  return [...list].sort((left, right) =>
    left.managesAgents === right.managesAgents
      ? left.name.localeCompare(right.name)
      : left.managesAgents
        ? -1
        : 1,
  );
}

function update(
  id: string,
  change: (group: OrgGroup) => OrgGroup,
): Promise<OrgGroup> {
  const group = store().get(id);
  if (!group) return Promise.reject(new Error("That group no longer exists."));
  if (group.source.kind === "directory") {
    return Promise.reject(
      new Error(
        `${group.name} is synced from ${group.source.provider}; change it there.`,
      ),
    );
  }
  const next = change(group);
  store().set(id, next);
  return Promise.resolve(next);
}

export function orgPeople(): readonly OrgPerson[] {
  return import.meta.env.DEV ? PEOPLE : [];
}

export function listGroups(): readonly OrgGroup[] {
  return sorted(store().values());
}

export function getGroup(id: string): OrgGroup | undefined {
  return store().get(id);
}

/** Groups an agent can grant access to: every group but the built-in one. */
export function grantableGroupNames(): readonly string[] {
  return listGroups()
    .filter((group) => !group.managesAgents)
    .map((group) => group.name);
}

/** Each agent with the level this group holds on it, or null for none. */
export function groupAgentAccess(
  name: string,
): readonly { agent: StoredAgent; level: AgentAccessLevel | null }[] {
  return storedAgents().map((agent) => ({
    agent,
    level: agent.access.find((grant) => grant.group === name)?.level ?? null,
  }));
}

export function setGroupAgentAccess(
  name: string,
  agentId: string,
  level: AgentAccessLevel | null,
): Promise<unknown> {
  return setAgentAccess(agentId, name, level);
}

function slug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Why a name can't be used for a new group, or null when it can. */
export function groupNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name, like Finance.";
  if (!slug(trimmed)) return "Use at least one letter or number.";
  const taken = [...store().values()].some(
    (group) =>
      group.id === slug(trimmed) ||
      group.name.toLowerCase() === trimmed.toLowerCase(),
  );
  return taken ? "A group with that name already exists." : null;
}

/** A group managed here, with no members and no agent access yet. */
export function createGroup(name: string): Promise<OrgGroup> {
  const problem = groupNameProblem(name);
  if (problem) return Promise.reject(new Error(problem));
  const group: OrgGroup = {
    id: slug(name),
    name: name.trim(),
    source: { kind: "manual" },
    managesAgents: false,
    memberIds: [],
  };
  store().set(group.id, group);
  return Promise.resolve(group);
}

/** Removes a group managed here, and every agent grant it held. */
export async function deleteGroup(id: string): Promise<void> {
  const group = store().get(id);
  if (!group) return;
  if (group.managesAgents || group.source.kind === "directory") {
    throw new Error(`${group.name} can't be deleted here.`);
  }
  for (const { agent, level } of groupAgentAccess(group.name)) {
    if (level) await setAgentAccess(agent.id, group.name, null);
  }
  store().delete(id);
}

export function addGroupMembers(
  id: string,
  personIds: readonly string[],
): Promise<OrgGroup> {
  return update(id, (group) => ({
    ...group,
    memberIds: [...new Set([...group.memberIds, ...personIds])],
  }));
}

export function removeGroupMember(
  id: string,
  personId: string,
): Promise<OrgGroup> {
  return update(id, (group) => ({
    ...group,
    memberIds: group.memberIds.filter((member) => member !== personId),
  }));
}

export type GroupSummary = {
  readonly id: string;
  readonly name: string;
  readonly source: GroupSource;
  readonly managesAgents: boolean;
  readonly memberCount: number;
  /** Agents this group can see or operate; every agent when it manages them. */
  readonly agentCount: number;
};

export type GroupAgentAccess = {
  readonly id: string;
  readonly name: string;
  readonly level: AgentAccessLevel | null;
  /** Everyone's baseline on the agent, which a group can only raise. */
  readonly everyone: AgentAccessLevel | null;
};

export type GroupDetail = {
  readonly id: string;
  readonly name: string;
  readonly source: GroupSource;
  readonly managesAgents: boolean;
  readonly members: readonly OrgPerson[];
  /** People in the organization who aren't members yet. */
  readonly candidates: readonly OrgPerson[];
  readonly agents: readonly GroupAgentAccess[];
};

/** The Groups tab: every group with its member and agent counts. */
export function groupSummaries(): readonly GroupSummary[] {
  const agentTotal = storedAgents().length;
  return listGroups().map((group) => ({
    id: group.id,
    name: group.name,
    source: group.source,
    managesAgents: group.managesAgents,
    memberCount: group.memberIds.length,
    agentCount: group.managesAgents
      ? agentTotal
      : groupAgentAccess(group.name).filter(({ level }) => level).length,
  }));
}

/** One group with its members, the people who could join, and its agents. */
export function groupDetail(id: string): GroupDetail | null {
  const group = getGroup(id);
  if (!group) return null;
  const people = orgPeople();
  const members = new Set(group.memberIds);
  return {
    id: group.id,
    name: group.name,
    source: group.source,
    managesAgents: group.managesAgents,
    members: people.filter((person) => members.has(person.id)),
    candidates: people.filter((person) => !members.has(person.id)),
    agents: groupAgentAccess(group.name).map(({ agent, level }) => ({
      id: agent.id,
      name: agent.name,
      level,
      everyone: agent.everyone,
    })),
  };
}
