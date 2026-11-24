import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import {
  audit,
  canonical,
  readAuditEvents,
  verifyAuditChain,
} from "../src/audit.ts";
import { withOrg, withoutOrg } from "../src/client.ts";
import type { Db } from "../src/client.ts";
import { failure, seedOrganization } from "./fixtures.ts";
import type { Org } from "./fixtures.ts";

let a: Org;

beforeAll(async () => {
  a = await seedOrganization("Hooli");
});

const asAdmin = async <T>(fn: (db: Db) => Promise<T>) => {
  const client = new pg.Client({
    connectionString: env.DB_ADMIN.connectionString,
  });
  await client.connect();
  try {
    return await fn(drizzle(client));
  } finally {
    client.on("error", () => {});
    await client.end();
  }
};

describe("canonical", () => {
  it("sorts keys and drops undefined, per RFC 8785", () => {
    expect(
      canonical({
        b: 1,
        a: [true, null, "x"],
        c: undefined,
        d: { z: 1, y: 2 },
      }),
    ).toBe('{"a":[true,null,"x"],"b":1,"d":{"y":2,"z":1}}');
  });
});

describe("audit chain", () => {
  it("appends gap-free and verifies", async () => {
    await withOrg(env, a.org, async (tx) => {
      await audit(tx, {
        organizationId: a.org,
        actorType: "person",
        actorId: a.userId,
        action: "group.member.added",
        targetType: "group",
        targetId: a.groupId,
        ip: "2001:db8::0:1",
        data: { group: "ap-team", n: 1.5 },
      });
    });
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withOrg(env, a.org, (tx) =>
          audit(tx, {
            organizationId: a.org,
            actorType: "platform",
            actorId: "platform:test",
            action: `test.${i}`,
          }),
        ),
      ),
    );
    const result = await withOrg(env, a.org, (tx) =>
      verifyAuditChain(tx, a.org),
    );
    expect(result).toMatchObject({ ok: true, checkedThroughSeq: 10 });
    const events = await withOrg(env, a.org, (tx) =>
      readAuditEvents(tx, a.org),
    );
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(events[1]?.ip).toBe("2001:db8::1");
  });

  it("is lost with the action when the transaction rolls back", async () => {
    const before = await withOrg(env, a.org, (tx) =>
      verifyAuditChain(tx, a.org),
    );
    await expect(
      withOrg(env, a.org, async (tx) => {
        await audit(tx, {
          organizationId: a.org,
          actorType: "person",
          actorId: a.userId,
          action: "group.created",
        });
        throw new Error("action failed");
      }),
    ).rejects.toThrow("action failed");
    const after = await withOrg(env, a.org, (tx) =>
      verifyAuditChain(tx, a.org),
    );
    expect(after).toEqual(before);
  });

  it("cannot be updated or deleted by the app or system roles", async () => {
    expect(
      await failure(
        withOrg(env, a.org, (tx) =>
          tx.execute(
            sql`update audit_events set action = 'x' where organization_id = ${a.org}`,
          ),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await failure(
        withoutOrg(env, "test check", (tx) =>
          tx.execute(
            sql`delete from audit_events where organization_id = ${a.org}`,
          ),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it("refuses updates even from the table owner", async () => {
    expect(
      await failure(
        asAdmin((db) =>
          db.execute(
            sql`update audit_events set action = 'x' where organization_id = ${a.org}`,
          ),
        ),
      ),
    ).toMatch(/append-only/);
    expect(
      await failure(asAdmin((db) => db.execute(sql`truncate audit_events`))),
    ).toMatch(/append-only/);
  });

  it("detects a rewritten event", async () => {
    const tampered = await seedOrganization("Tampered");
    await withOrg(env, tampered.org, (tx) =>
      audit(tx, {
        organizationId: tampered.org,
        actorType: "person",
        actorId: tampered.userId,
        action: "member.role.changed",
        data: { role: "admin" },
      }),
    );
    await asAdmin(async (db) => {
      await db.execute(
        sql`alter table audit_events disable trigger audit_events_no_update`,
      );
      try {
        await db.execute(
          sql`update audit_events set data = '{"role":"owner"}' where organization_id = ${tampered.org} and seq = 2`,
        );
      } finally {
        await db.execute(
          sql`alter table audit_events enable trigger audit_events_no_update`,
        );
      }
    });
    const result = await withOrg(env, tampered.org, (tx) =>
      verifyAuditChain(tx, tampered.org),
    );
    expect(result).toMatchObject({
      ok: false,
      checkedThroughSeq: 1,
      firstBreak: { seq: 2, reason: "hash_mismatch" },
    });
  });
});
