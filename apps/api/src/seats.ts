// Seats (spec 16 Limits and 16a): developers plus operators. A seat is a
// member of the Developers group or of any group with operator access to an
// agent, counted once however many such groups they are in. Owners, Admins and
// viewers in no such group are free. Run these in the organization's
// transaction: RLS scopes every read to it, and group_members holds only the
// organization's members. The license's limit is soft: Admins are warned at
// it, and changes that add seats past about 10% over it are refused.

import type { Tx } from "@preprocess/db/client";
import {
  agentGrants,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import { and, eq, inArray, or } from "drizzle-orm";

import { ApiError } from "./cases.ts";
import type { Plan } from "./plan.ts";

const operatorGroups = (tx: Tx) =>
  tx
    .select({ id: agentGrants.groupId })
    .from(agentGrants)
    .where(eq(agentGrants.access, "operator"));

// The people holding a seat, counting `extraGroup`'s members as if it were a
// seat group.
const seatHolders = async (tx: Tx, extraGroup?: string) => {
  const rows = await tx
    .selectDistinct({ userId: groupMembers.userId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      or(
        eq(groups.isDevelopers, true),
        inArray(groupMembers.groupId, operatorGroups(tx)),
        extraGroup ? eq(groupMembers.groupId, extraGroup) : undefined,
      ),
    );
  return new Set(rows.map((r) => r.userId));
};

export const countSeats = async (tx: Tx) => (await seatHolders(tx)).size;

// The most seats changes may reach: about 10% over the limit.
export const seatCeiling = (limit: number) => Math.floor(limit * 1.1);

const isSeatGroup = async (tx: Tx, groupId: string) => {
  const [found] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(
      and(
        eq(groups.id, groupId),
        or(
          eq(groups.isDevelopers, true),
          inArray(groups.id, operatorGroups(tx)),
        ),
      ),
    );
  return Boolean(found);
};

// Refuses adding `user` to `group` (when given), or making `group` a seat
// group with an operator grant, when that adds seats past the ceiling.
export const refuseOverSeats = async (
  tx: Tx,
  plan: Plan,
  change: { group: string; user?: string },
) => {
  const limit = plan.limits.seats;
  if (limit === null) return;
  const before = await seatHolders(tx);
  if (change.user !== undefined) {
    if (before.has(change.user)) return;
    if (!(await isSeatGroup(tx, change.group))) return;
  }
  const after = await seatHolders(tx, change.group);
  if (change.user !== undefined) after.add(change.user);
  if (after.size <= before.size || after.size <= seatCeiling(limit)) return;
  throw new ApiError(
    402,
    "seat_limit_reached",
    plan.license
      ? `This would make ${after.size} developer and operator seats, and the license covers ${limit}. Free a seat or extend the license first.`
      : `This would make ${after.size} developer and operator seats, and the ${plan.name} plan includes ${limit}. Free a seat or upgrade first.`,
  );
};
