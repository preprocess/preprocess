import { createServerFn } from "@tanstack/react-start";

import type { AgentAccessLevel } from "../agents/agent-seed";
import { orgApi } from "../auth/client";

/**
 * Organization groups from the API. Agent access is granted to groups; the
 * built-in Developers group manages every agent. Reads run as server
 * functions for the route loaders; writes go straight to /v1 from the
 * browser.
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

type ApiGroup = {
  id: string;
  name: string;
  isDevelopers: boolean;
  memberCount: number;
};

type ApiGroupDetail = ApiGroup & {
  members: { userId: string; name: string; email: string }[];
  grants: { agentId: string; agentSlug: string; access: AgentAccessLevel }[];
};

type ApiMember = { userId: string; name: string; email: string };

const MANUAL: GroupSource = { kind: "manual" };

/** The Groups tab: Developers first, then the rest by name. */
export const groupSummaries = createServerFn({ method: "GET" }).handler(
  async (): Promise<GroupSummary[]> => {
    const { activeOrgJson } = await import("../../server/api.server");
    const groups = await activeOrgJson<ApiGroup[]>("/groups");
    return groups
      .map((group) => ({
        id: group.id,
        name: group.name,
        source: MANUAL,
        managesAgents: group.isDevelopers,
        memberCount: group.memberCount,
        agentCount: 0,
      }))
      .sort((left, right) =>
        left.managesAgents === right.managesAgents
          ? left.name.localeCompare(right.name)
          : left.managesAgents
            ? -1
            : 1,
      );
  },
);

/** One group with its members, the people who could join, and its agents. */
export const groupDetail = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }): Promise<GroupDetail | null> => {
    const { activeOrgJson } = await import("../../server/api.server");
    const [group, people] = await Promise.all([
      activeOrgJson<ApiGroupDetail | null>(
        `/groups/${encodeURIComponent(id)}`,
        {
          notFound: null,
        },
      ),
      activeOrgJson<ApiMember[]>("/members"),
    ]);
    if (!group) return null;
    const members = new Set(group.members.map((member) => member.userId));
    const person = (member: ApiMember): OrgPerson => ({
      id: member.userId,
      name: member.name,
      email: member.email,
    });
    return {
      id: group.id,
      name: group.name,
      source: MANUAL,
      managesAgents: group.isDevelopers,
      members: group.members.map(person),
      candidates: people
        .filter((member) => !members.has(member.userId))
        .map(person),
      agents: group.grants.map((grant) => ({
        id: grant.agentId,
        name: grant.agentSlug,
        level: grant.access,
        everyone: null,
      })),
    };
  });

export const createGroup = (organizationId: string, name: string) =>
  orgApi<{ id: string; name: string }>(organizationId, "/groups", {
    method: "POST",
    body: JSON.stringify({ name: name.trim() }),
  });

export const deleteGroup = (organizationId: string, groupId: string) =>
  orgApi(organizationId, `/groups/${groupId}`, { method: "DELETE" });

export const addGroupMember = (
  organizationId: string,
  groupId: string,
  userId: string,
) =>
  orgApi(organizationId, `/groups/${groupId}/members/${userId}`, {
    method: "PUT",
  });

export const removeGroupMember = (
  organizationId: string,
  groupId: string,
  userId: string,
) =>
  orgApi(organizationId, `/groups/${groupId}/members/${userId}`, {
    method: "DELETE",
  });

export const setGroupAgentAccess = (
  organizationId: string,
  groupId: string,
  agentId: string,
  level: AgentAccessLevel | null,
) =>
  orgApi(organizationId, `/agents/${agentId}/grants/${groupId}`, {
    method: level ? "PUT" : "DELETE",
    body: level ? JSON.stringify({ access: level }) : undefined,
  });
