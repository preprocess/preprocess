// Evals on each new deployment (design doc 09) are not built yet: turning
// evals.onPush or a suite's runOnPush on is refused with 400 not_available,
// turning them off still works, and values stored before the guard read as
// they are.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { evalSuites } from "@preprocess/db/schema/evals";
import { organizationDefaults } from "@preprocess/db/schema/settings";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { Client } from "./helpers.ts";
import { createOrganization, signUp, testEnv } from "./helpers.ts";

const environment = testEnv();
type Failure = { error: { code: string; message: string } };

let owner: Client;
let org: string;
let ownerId: string;
const agentId = newId("agent");

const notAvailable = (response: { status: number; body: unknown }) => {
  expect(response.status).toBe(400);
  expect((response.body as Failure).error).toEqual({
    code: "not_available",
    message: "Running evals on each new deployment is not available yet.",
  });
};

beforeAll(async () => {
  const signed = await signUp("Pusher", environment);
  owner = signed.client;
  ownerId = signed.userId;
  org = await createOrganization(owner, "Pushco");
  await withOrg(environment, orgId(org), (tx) =>
    tx
      .insert(agents)
      .values({ id: agentId, organizationId: org, slug: "invoices" }),
  );
});

describe("evals on push", () => {
  it("refuses turning evals.onPush on, as a default or an override", async () => {
    notAvailable(
      await owner.call(`/v1/orgs/${org}/defaults`, {
        method: "PATCH",
        body: { "evals.onPush": true },
      }),
    );
    notAvailable(
      await owner.call(
        `/v1/orgs/${org}/agents/invoices/settings/evals.onPush`,
        {
          method: "PUT",
          body: { value: true },
        },
      ),
    );
    const off = await owner.call(`/v1/orgs/${org}/defaults`, {
      method: "PATCH",
      body: { "evals.onPush": false },
    });
    expect(off.status).toBe(200);
  });

  it("refuses runOnPush on a new or edited suite", async () => {
    notAvailable(
      await owner.call(`/v1/orgs/${org}/agents/invoices/eval-suites`, {
        body: { name: "On push", runOnPush: true },
      }),
    );
    const created = await owner.call<{ id: string; runOnPush: boolean }>(
      `/v1/orgs/${org}/agents/invoices/eval-suites`,
      { body: { name: "Manual", runOnPush: false } },
    );
    expect(created.status).toBe(201);
    notAvailable(
      await owner.call(`/v1/orgs/${org}/eval-suites/${created.body.id}`, {
        method: "PATCH",
        body: { runOnPush: true },
      }),
    );
  });

  it("reads values stored before the guard", async () => {
    const id = newId("evalSuite");
    await withOrg(environment, orgId(org), async (tx) => {
      await tx.insert(evalSuites).values({
        id,
        organizationId: org,
        agentId,
        name: "Stored",
        kind: "manual",
        runOnPush: true,
        createdBy: ownerId,
      });
      await tx
        .update(organizationDefaults)
        .set({ values: { "evals.onPush": true } })
        .where(eq(organizationDefaults.organizationId, org));
    });
    const suite = await owner.call<{ runOnPush: boolean }>(
      `/v1/orgs/${org}/eval-suites/${id}`,
    );
    expect(suite.status).toBe(200);
    expect(suite.body.runOnPush).toBe(true);
    const defaults = await owner.call(`/v1/orgs/${org}/defaults`);
    expect(defaults.status).toBe(200);
    expect(defaults.body).toMatchObject({ "evals.onPush": true });
    const settings = await owner.call<{
      settings: { key: string; value: unknown }[];
    }>(`/v1/orgs/${org}/agents/invoices/settings`);
    expect(settings.status).toBe(200);
    expect(
      settings.body.settings.find((s) => s.key === "evals.onPush")?.value,
    ).toBe(true);
    // Turning a stored value off still works.
    const off = await owner.call<{ runOnPush: boolean }>(
      `/v1/orgs/${org}/eval-suites/${id}`,
      { method: "PATCH", body: { runOnPush: false } },
    );
    expect(off.body.runOnPush).toBe(false);
  });
});
