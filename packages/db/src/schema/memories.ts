// Supervised memory (spec 10): rules the agent proposes on a case. A person
// with operator access accepts or dismisses each; accepted rules reach every
// new case and rerun of the agent until someone deletes them.

import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { agents } from "./access.ts";

export const MEMORY_CAP = 100;
export const MEMORY_TEXT_MAX = 500;

export type MemoryStatus = "proposed" | "accepted" | "dismissed" | "deleted";

export const agentMemories = pgTable(
  "agent_memories",
  {
    id: text().primaryKey(),
    organizationId: text().notNull(),
    agentId: text().notNull(),
    // The case it was proposed on. No foreign key: deleting the case keeps
    // an accepted rule.
    caseId: text().notNull(),
    text: text().notNull(),
    reason: text(),
    status: text().$type<MemoryStatus>().notNull(),
    proposedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedBy: text(),
    decidedAt: timestamp({ withTimezone: true }),
    deletedBy: text(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    // Proposing the same rule twice on one case keeps one proposal.
    unique().on(t.organizationId, t.caseId, t.text),
    index().on(t.organizationId, t.agentId, t.status),
    index().on(t.organizationId, t.status),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
    }).onDelete("cascade"),
  ],
);
