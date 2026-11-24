import { DurableObject } from "cloudflare:workers";

import type { Env } from "./env.ts";

// One SQLite-backed object per name. Names include the organization
// (spec 15), for example "org_acme:counter".
export class Counter extends DurableObject<Env> {
  async increment(): Promise<number> {
    const next = ((await this.ctx.storage.get<number>("count")) ?? 0) + 1;
    await this.ctx.storage.put("count", next);
    return next;
  }
}
