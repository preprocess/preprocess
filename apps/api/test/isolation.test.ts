// Cross-organization checks through the HTTP API (spec 15): a member of one
// organization gets nothing from another, by path or by reference.

import { describe, expect, it } from "vitest";

import { addMember, createOrganization, signUp } from "./helpers.ts";

describe("another organization's data", () => {
  it("is refused on every route", async () => {
    const a = await signUp("Alice");
    await createOrganization(a.client, "Alpha");
    const b = await signUp("Bob");
    const orgB = await createOrganization(b.client, "Bravo");
    const bGroup = await b.client.call<{ id: string }>(
      `/v1/orgs/${orgB}/groups`,
      { body: { name: "Secret team" } },
    );

    for (const path of [
      `/v1/orgs/${orgB}/members`,
      `/v1/orgs/${orgB}/groups`,
      `/v1/orgs/${orgB}/groups/${bGroup.body.id}`,
      `/v1/orgs/${orgB}/audit-events`,
      `/v1/orgs/${orgB}/plan`,
      `/v1/orgs/${orgB}/models`,
    ])
      expect((await a.client.call(path)).status, path).toBe(403);
    expect(
      (
        await a.client.call(`/v1/orgs/${orgB}/audit-events/verify`, {
          body: {},
        })
      ).status,
    ).toBe(403);
  });

  it("cannot be reached through ids in your own organization's paths", async () => {
    const a = await signUp("Carol");
    const orgA = await createOrganization(a.client, "Charlie");
    const b = await signUp("Dave");
    const orgB = await createOrganization(b.client, "Delta");
    const bGroup = await b.client.call<{ id: string }>(
      `/v1/orgs/${orgB}/groups`,
      { body: { name: "Delta team" } },
    );
    const aGroup = await a.client.call<{ id: string }>(
      `/v1/orgs/${orgA}/groups`,
      { body: { name: "Charlie team" } },
    );

    // B's group under A's path does not exist for A.
    expect(
      (await a.client.call(`/v1/orgs/${orgA}/groups/${bGroup.body.id}`)).status,
    ).toBe(404);
    expect(
      (
        await a.client.call(`/v1/orgs/${orgA}/groups/${bGroup.body.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    // B's owner cannot be put in A's group.
    expect(
      (
        await a.client.call(
          `/v1/orgs/${orgA}/groups/${aGroup.body.id}/members/${b.userId}`,
          { method: "PUT" },
        )
      ).status,
    ).toBe(400);
    // B's audit log stays B's.
    const events = await a.client.call<{
      events: { organizationId: string }[];
    }>(`/v1/orgs/${orgA}/audit-events`);
    expect(new Set(events.body.events.map((e) => e.organizationId))).toEqual(
      new Set([orgA]),
    );
  });

  it("is refused to a member who belongs to both, per organization role", async () => {
    const owner = await signUp("Erin");
    const orgE = await createOrganization(owner.client, "Echo");
    const shared = await addMember(owner.client, orgE, "Frank");
    const orgF = await createOrganization(shared.client, "Foxtrot");
    // Owner of Foxtrot, plain member of Echo: can manage groups only in Foxtrot.
    expect(
      (
        await shared.client.call(`/v1/orgs/${orgF}/groups`, {
          body: { name: "F" },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await shared.client.call(`/v1/orgs/${orgE}/groups`, {
          body: { name: "E" },
        })
      ).status,
    ).toBe(403);
  });
});
