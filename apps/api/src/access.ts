// Effective access to an agent (design doc 01): the one function the API and
// the inbox use.

import type { Tx } from "@preprocess/db/client";
import {
  agentGrants,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import { and, eq } from "drizzle-orm";

import type { Caller } from "./caller.ts";

export type AgentRole = "manage" | "operator" | "viewer" | null;

// manage if in the Developers group; else the highest of the person's
// groups' grants on the agent; else null. Organization API keys are
// organization-wide and work every agent's cases.
export const agentRole = async (
  tx: Tx,
  caller: Caller,
  agentId: string,
): Promise<AgentRole> => {
  if (caller.type === "api_key") return "operator";
  const rows = await tx
    .select({ isDevelopers: groups.isDevelopers, access: agentGrants.access })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .leftJoin(
      agentGrants,
      and(eq(agentGrants.groupId, groups.id), eq(agentGrants.agentId, agentId)),
    )
    .where(eq(groupMembers.userId, caller.userId));
  if (rows.some((r) => r.isDevelopers)) return "manage";
  if (rows.some((r) => r.access === "operator")) return "operator";
  if (rows.some((r) => r.access === "viewer")) return "viewer";
  return null;
};

// Owners and Admins see every case; seeing one that way does not make them
// an operator.
export const canSeeCase = (caller: Caller, role: AgentRole) =>
  caller.role === "owner" || caller.role === "admin" || role !== null;

// Working a case (start, edit, rerun, cancel) needs an operator group or
// Developers.
export const canWorkCase = (role: AgentRole) =>
  role === "manage" || role === "operator";
