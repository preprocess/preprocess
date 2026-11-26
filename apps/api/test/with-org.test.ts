// withOrg sends BEGIN, SET LOCAL ROLE and the organization setting as one
// query. These check that the folded setup still isolates organizations:
// the role and organization hold for the whole transaction and end with it,
// rows of another organization stay invisible, a failure rolls back, and an
// organization id cannot escape its literal.

import { orgId, withOrg, withoutOrgRead } from "@preprocess/db/client";
import { groups } from "@preprocess/db/schema/access";
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createOrganization, signUp } from "./helpers.ts";

type Setting = { role: string; org: string | null; at: string };
const setting = sql`select current_user as role, current_setting('app.org_id', true) as org, now()::text as at`;

describe("withOrg", () => {
  it("holds the role and organization for the whole transaction, and only for it", async () => {
    const a = await signUp("Wren");
    const org = await createOrganization(a.client, "Wren Co");

    const [first, second] = await withOrg(env, orgId(org), async (tx) => [
      (await tx.execute<Setting>(setting)).rows[0],
      (await tx.execute<Setting>(setting)).rows[0],
    ]);
    expect(first).toMatchObject({ role: "preprocess_app", org });
    // now() is fixed per transaction, so both statements ran in one.
    expect(second).toEqual(first);

    const after = await withoutOrgRead(
      env,
      "test",
      async (tx) => (await tx.execute<Setting>(setting)).rows[0],
    );
    expect(after?.role).not.toBe("preprocess_app");
    expect(after?.org || null).toBeNull();
  });

  it("shows one organization's rows and none of another's", async () => {
    const a = await signUp("Yara");
    const orgA = await createOrganization(a.client, "Yara Co");
    const b = await signUp("Zane");
    const orgB = await createOrganization(b.client, "Zane Co");
    await a.client.call(`/v1/orgs/${orgA}/groups`, {
      body: { name: "Yara team" },
    });
    await b.client.call(`/v1/orgs/${orgB}/groups`, {
      body: { name: "Zane team" },
    });

    const seen = await withOrg(env, orgId(orgA), (tx) =>
      tx.select({ organizationId: groups.organizationId }).from(groups),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((row) => row.organizationId))).toEqual(
      new Set([orgA]),
    );
  });

  it("rolls back everything when the work fails", async () => {
    const a = await signUp("Abel");
    const org = await createOrganization(a.client, "Abel Co");
    const listed = () =>
      withOrg(env, orgId(org), (tx) =>
        tx.select({ name: groups.name }).from(groups),
      );
    const before = await listed();

    await expect(
      withOrg(env, orgId(org), async (tx) => {
        await tx.insert(groups).values({
          id: "grp_rolled_back",
          organizationId: org,
          slug: "rolled-back",
          name: "Rolled back",
        });
        throw new Error("fails after writing");
      }),
    ).rejects.toThrow("fails after writing");
    expect(await listed()).toEqual(before);
  });

  it("keeps an organization id inside its literal", async () => {
    const hostile = "org_x'); reset role; select ('";
    const seen = await withOrg(env, orgId(hostile), async (tx) => ({
      row: (await tx.execute<Setting>(setting)).rows[0],
      visible: await tx
        .select({ organizationId: groups.organizationId })
        .from(groups),
    }));
    expect(seen.row).toMatchObject({ role: "preprocess_app", org: hostile });
    expect(seen.visible).toEqual([]);
  });
});
