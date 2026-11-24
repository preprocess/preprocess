import { withoutOrg } from "@preprocess/db/client";
import { idempotencyKeys } from "@preprocess/db/schema/cases";
import { lt, sql } from "drizzle-orm";

import type { Env } from "./env.ts";

// Idempotency keys live 24 hours (design doc 04); the daily job removes them
// in every organization.
export const deleteExpiredIdempotencyKeys = (env: Env) =>
  withoutOrg(env, "expire idempotency keys", (tx) =>
    tx.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, sql`now()`)),
  );
