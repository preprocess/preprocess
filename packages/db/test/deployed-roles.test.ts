import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { withOrg } from "../src/client.ts";
import { ident, seedOrganization, tenantTables } from "./fixtures.ts";
import type { Org } from "./fixtures.ts";

// On deployed stages DB logs in as the stage's PlanetScale role, which has
// BYPASSRLS and reaches preprocess_app only through role membership
// (infra/alchemy.run.ts). DB_BYPASS has that shape; DB_MEMBER is a member
// without BYPASSRLS.
const member = { ...env, DB: env.DB_MEMBER };
const bypass = { ...env, DB: env.DB_BYPASS };

let a: Org;
let b: Org;

beforeAll(async () => {
  a = await seedOrganization("Initech");
  b = await seedOrganization("Umbrella");
});

describe.each([
  ["a member of preprocess_app", member],
  ["a member of preprocess_app with BYPASSRLS", bypass],
])("withOrg logged in as %s", (_, db) => {
  it.each(Object.entries(tenantTables))(
    "reads only its own organization's %s rows",
    async (table, column) => {
      const rows = await withOrg(db, a.org, (tx) =>
        tx.execute<{ org: string }>(
          sql`select ${ident(column)} as org from ${ident(table)}`,
        ),
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      expect(new Set(rows.rows.map((r) => r.org))).toEqual(new Set([a.org]));
      const other = await withOrg(db, a.org, (tx) =>
        tx.execute(
          sql`select 1 from ${ident(table)} where ${ident(column)} = ${b.org}`,
        ),
      );
      expect(other.rows).toEqual([]);
    },
  );
});
