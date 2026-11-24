import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { withOrg, withoutOrg } from "../src/client.ts";
import { failure, ident, seedOrganization, tenantTables } from "./fixtures.ts";
import type { Org } from "./fixtures.ts";

let a: Org;
let b: Org;

beforeAll(async () => {
  a = await seedOrganization("Acme");
  b = await seedOrganization("Globex");
});

const count = (rows: { rows: unknown[] }) => rows.rows.length;

describe.each(Object.entries(tenantTables))("%s", (table, column) => {
  it("shows withOrg only its own organization's rows", async () => {
    const rows = await withOrg(env, a.org, (tx) =>
      tx.execute<{ org: string }>(
        sql`select ${ident(column)} as org from ${ident(table)}`,
      ),
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(new Set(rows.rows.map((r) => r.org))).toEqual(new Set([a.org]));
  });

  it("cannot read, update or delete another organization's rows", async () => {
    await withOrg(env, a.org, async (tx) => {
      const where = sql`where ${ident(column)} = ${b.org}`;
      expect(
        count(await tx.execute(sql`select 1 from ${ident(table)} ${where}`)),
      ).toBe(0);
    });
    // Updates and deletes either see no rows or are refused outright.
    for (const statement of [
      sql`update ${ident(table)} set ${ident(column)} = ${ident(column)} where ${ident(column)} = ${b.org}`,
      sql`delete from ${ident(table)} where ${ident(column)} = ${b.org}`,
    ]) {
      const result = await withOrg(env, a.org, (tx) =>
        tx.execute(statement),
      ).then(
        (r) => r.rowCount,
        (error: { cause?: Error }) => error.cause?.message,
      );
      expect(
        result === 0 || /permission denied|append-only/.test(String(result)),
      ).toBe(true);
    }
    const still = await withoutOrg(env, "test check", (tx) =>
      tx.execute(
        sql`select 1 from ${ident(table)} where ${ident(column)} = ${b.org}`,
      ),
    );
    expect(count(still)).toBeGreaterThan(0);
  });

  it("returns nothing on DB without app.org_id", async () => {
    const client = new pg.Client({ connectionString: env.DB.connectionString });
    await client.connect();
    try {
      const rows = await drizzle(client).execute(
        sql`select 1 from ${ident(table)}`,
      );
      expect(count(rows)).toBe(0);
    } finally {
      client.on("error", () => {});
      await client.end();
    }
  });
});

describe("writes", () => {
  it("refuse a row for another organization", async () => {
    expect(
      await failure(
        withOrg(env, a.org, (tx) =>
          tx.execute(
            sql`insert into groups (id, organization_id, slug, name) values ('grp_x', ${b.org}, 'x', 'X')`,
          ),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it("refuse moving a row to another organization", async () => {
    await expect(
      withOrg(env, a.org, (tx) =>
        tx.execute(
          sql`update agents set organization_id = ${b.org} where id = ${a.agentId}`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuse linking another organization's group or agent", async () => {
    expect(
      await failure(
        withOrg(env, a.org, (tx) =>
          tx.execute(
            sql`insert into agent_grants (organization_id, agent_id, group_id, access, granted_by)
              values (${a.org}, ${a.agentId}, ${b.groupId}, 'viewer', 'usr_x')`,
          ),
        ),
      ),
    ).toMatch(/foreign key/);
  });
});

describe("row-level security coverage", () => {
  it("is enabled and forced on every table with an organization column", async () => {
    const tables = await withoutOrg(env, "test check", (tx) =>
      tx.execute<{
        table: string;
        rls: boolean;
        forced: boolean;
        policies: number;
      }>(sql`
        select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
               (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where c.relkind = 'r' and exists (
          select 1 from information_schema.columns col
          where col.table_name = c.relname and col.column_name = 'organization_id')
      `),
    );
    const exempt = new Set(["deleted_organizations"]);
    const missing = tables.rows.filter(
      (t) => !exempt.has(t.table) && !(t.rls && t.forced && t.policies > 0),
    );
    expect(missing).toEqual([]);
    for (const t of tables.rows)
      if (!exempt.has(t.table))
        expect(Object.keys(tenantTables)).toContain(t.table);
  });
});
