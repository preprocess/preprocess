import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { withOrg } from "../src/client.ts";
import { ident, seedOrganization, tenantTables } from "./fixtures.ts";
import type { Org } from "./fixtures.ts";

// On deployed stages DB logs in as its own PlanetScale role, a member of
// preprocess_app without BYPASSRLS (infra/src/app-role.ts). DB_MEMBER has
// that shape; DB_BYPASS is the same member with BYPASSRLS.
const member = { ...env, DB: env.DB_MEMBER };
const bypass = { ...env, DB: env.DB_BYPASS };

let a: Org;
let b: Org;

beforeAll(async () => {
  a = await seedOrganization("Initech");
  b = await seedOrganization("Umbrella");
});

describe("withOrg logged in as a member of preprocess_app", () => {
  it.each(Object.entries(tenantTables))(
    "reads only its own organization's %s rows",
    async (table, column) => {
      const rows = await withOrg(member, a.org, (tx) =>
        tx.execute<{ org: string }>(
          sql`select ${ident(column)} as org from ${ident(table)}`,
        ),
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      expect(new Set(rows.rows.map((r) => r.org))).toEqual(new Set([a.org]));
      const other = await withOrg(member, a.org, (tx) =>
        tx.execute(
          sql`select 1 from ${ident(table)} where ${ident(column)} = ${b.org}`,
        ),
      );
      expect(other.rows).toEqual([]);
    },
  );
});

describe("withOrg", () => {
  it("refuses a login role that bypasses row-level security", async () => {
    await expect(
      withOrg(bypass, a.org, () => Promise.resolve("read")),
    ).rejects.toThrow(/bypasses row-level security/);
  });
});
