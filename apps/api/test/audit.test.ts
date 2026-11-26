import { describe, expect, it } from "vitest";

import {
  anchorDay,
  anchorOrganization,
  dayOf,
  manifestKey,
} from "../src/audit-anchor.ts";
import type { AuditManifest } from "../src/audit-anchor.ts";
import { addMember, Client, createOrganization, signUp } from "./helpers.ts";

type Verification = {
  ok: boolean;
  checkedThroughSeq: number;
  anchorsChecked: number;
  firstBreak?: { seq: number; reason: string };
};

const setup = async () => {
  const owner = await signUp("Auditor");
  const org = await createOrganization(owner.client, "Audited");
  const member = await addMember(owner.client, org, "Teammate");
  const group = await owner.client.call<{ id: string }>(
    `/v1/orgs/${org}/groups`,
    { body: { name: "Legal" } },
  );
  await owner.client.call(
    `/v1/orgs/${org}/groups/${group.body.id}/members/${member.userId}`,
    { method: "PUT" },
  );
  return { owner, org, member, group: group.body.id };
};

describe("audit log", () => {
  it("records each action with its actor, in order", async () => {
    const { owner, org, member } = await setup();
    const result = await owner.client.call<{
      events: { seq: number; action: string; actorId: string }[];
    }>(`/v1/orgs/${org}/audit-events`);
    expect(result.body.events.map((e) => e.action)).toEqual([
      "organization.created",
      "invitation.created",
      "member.added",
      "group.created",
      "group.member.added",
    ]);
    expect(result.body.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(result.body.events[2]?.actorId).toBe(member.userId);
    expect(result.body.events[4]?.actorId).toBe(owner.userId);
  });

  it("is readable by Owners and Admins only", async () => {
    const { org, member } = await setup();
    expect(
      (await member.client.call(`/v1/orgs/${org}/audit-events`)).status,
    ).toBe(403);
  });

  it("verifies, with each day's signed manifest checked against the chain", async () => {
    const { owner, org } = await setup();
    const environment = owner.client.environment;
    const today = dayOf(new Date());
    const manifest = await anchorDay(environment, org, today);
    expect(manifest).toMatchObject({
      organizationId: org,
      firstSeq: 1,
      lastSeq: 5,
      count: 5,
    });
    // Idempotent per (organization, day).
    expect(await anchorDay(environment, org, today)).toEqual(manifest);

    const verified = await owner.client.call<Verification>(
      `/v1/orgs/${org}/audit-events/verify`,
      { body: {} },
    );
    expect(verified.body).toEqual({
      ok: true,
      checkedThroughSeq: 5,
      anchorsChecked: 1,
    });

    const keys = await new Client().call<{ keyId: string; x: string }[]>(
      "/v1/audit/keys",
    );
    expect(keys.body[0]?.keyId).toBe(environment.AUDIT_SIGNING_KEY_ID);
  });

  it("fails verification when a signed manifest is altered", async () => {
    const { owner, org } = await setup();
    const environment = owner.client.environment;
    const day = dayOf(new Date());
    const manifest = await anchorDay(environment, org, day);
    await environment.AUDIT.put(
      manifestKey(org, day),
      JSON.stringify({
        ...manifest,
        headHash: "0".repeat(64),
      } satisfies AuditManifest),
    );
    const verified = await owner.client.call<Verification>(
      `/v1/orgs/${org}/audit-events/verify`,
      { body: {} },
    );
    expect(verified.body).toMatchObject({
      ok: false,
      firstBreak: { reason: "anchor_mismatch" },
    });
  });

  it("anchors empty days too, so the cron job covers every organization", async () => {
    const { owner, org } = await setup();
    const environment = owner.client.environment;
    const tomorrow = dayOf(new Date(Date.now() + 86_400_000));
    expect(await anchorOrganization(environment, org, tomorrow)).toEqual([
      dayOf(new Date()),
      tomorrow,
    ]);
    const empty = await (
      await environment.AUDIT.get(manifestKey(org, tomorrow))
    )?.json<AuditManifest>();
    expect(empty).toMatchObject({ firstSeq: null, count: 0, lastSeq: 5 });
    const verified = await owner.client.call<Verification>(
      `/v1/orgs/${org}/audit-events/verify`,
      { body: {} },
    );
    expect(verified.body).toMatchObject({ ok: true, anchorsChecked: 2 });
  });
});

describe("entitlements", () => {
  it("put every organization on the free plan, with export refused", async () => {
    const { owner, org } = await setup();
    const plan = await owner.client.call<{
      name: string;
      features: Record<string, boolean>;
    }>(`/v1/orgs/${org}/plan`);
    expect(plan.body.name).toBe("free");
    expect(Object.values(plan.body.features).every((v) => v === false)).toBe(
      true,
    );
    const exported = await owner.client.call(
      `/v1/orgs/${org}/audit-events/export`,
      {
        body: {},
      },
    );
    expect(exported.status).toBe(403);
  });
});
