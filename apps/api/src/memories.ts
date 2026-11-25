// Supervised memory (spec 10). The runtime proposes rules through the
// Platform entrypoint; people decide them in the case's Review tab, and
// accepted rules go to every new case, rerun and eval run of the agent.

import { orgId, withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { cases } from "@preprocess/db/schema/cases";
import {
  agentMemories,
  MEMORY_CAP,
  MEMORY_TEXT_MAX,
} from "@preprocess/db/schema/memories";
import { and, asc, count, eq, inArray } from "drizzle-orm";

import type { Env } from "./env.ts";

export type MemoryRule = { id: string; text: string };

export type MemoryProposal = {
  organizationId: string;
  agentId: string;
  caseId: string;
  text: string;
  reason: string | null;
};

export type ProposeResult =
  | { result: "proposed" | "duplicate"; id: string }
  | { result: "refused"; reason: string };

// Oldest first, so a rule keeps its place in the prompt as others are added.
export const acceptedMemories = (tx: Tx, agentId: string) =>
  tx
    .select({ id: agentMemories.id, text: agentMemories.text })
    .from(agentMemories)
    .where(
      and(
        eq(agentMemories.agentId, agentId),
        eq(agentMemories.status, "accepted"),
      ),
    )
    .orderBy(asc(agentMemories.decidedAt), asc(agentMemories.id));

// Accepted and still-proposed rules both count toward the cap.
export const memoriesHeld = async (tx: Tx, agentId: string) => {
  const [held] = await tx
    .select({ n: count() })
    .from(agentMemories)
    .where(
      and(
        eq(agentMemories.agentId, agentId),
        inArray(agentMemories.status, ["accepted", "proposed"]),
      ),
    );
  return held?.n ?? 0;
};

export const proposeMemory = (
  env: Env,
  proposal: MemoryProposal,
): Promise<ProposeResult> => {
  const text = proposal.text.trim();
  if (!text)
    return Promise.resolve({ result: "refused", reason: "The rule is empty." });
  if (text.length > MEMORY_TEXT_MAX)
    return Promise.resolve({
      result: "refused",
      reason: `A rule is at most ${MEMORY_TEXT_MAX} characters.`,
    });
  return withOrg(env, orgId(proposal.organizationId), async (tx) => {
    const [known] = await tx
      .select({ id: cases.id })
      .from(cases)
      .where(
        and(eq(cases.id, proposal.caseId), eq(cases.agentId, proposal.agentId)),
      );
    if (!known) return { result: "refused", reason: "Unknown case." } as const;
    const [same] = await tx
      .select({ id: agentMemories.id })
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.caseId, proposal.caseId),
          eq(agentMemories.text, text),
        ),
      );
    if (same) return { result: "duplicate", id: same.id } as const;
    if ((await memoriesHeld(tx, proposal.agentId)) >= MEMORY_CAP)
      return {
        result: "refused",
        reason: `This agent already holds ${MEMORY_CAP} rules; a person must delete one before you propose another.`,
      } as const;
    const id = newId("memory");
    await tx.insert(agentMemories).values({
      id,
      organizationId: proposal.organizationId,
      agentId: proposal.agentId,
      caseId: proposal.caseId,
      text,
      reason: proposal.reason?.trim() || null,
      status: "proposed",
    });
    return { result: "proposed", id } as const;
  });
};
