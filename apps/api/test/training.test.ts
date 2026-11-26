// Training (spec 12a) is Coming soon: a member of the organization, or its
// API key, cannot start a training run, Retrain on corrections, or reach the
// Tinker-compatible training API; each answers 501 coming_soon. Without a
// credential for the organization they answer as any other org route does.

import { beforeAll, describe, expect, it } from "vitest";

import { addMember, Client, createOrganization, signUp } from "./helpers.ts";

let org: string;
let owner: Client;
let member: Client;
let keyed: Client;

const refusals = [
  ["POST", "/training/runs"],
  ["POST", "/agents/invoices/retrain"],
  ["POST", "/training/tinker/api/v1/create_model"],
  ["GET", "/training/tinker/api/v1/get_server_capabilities"],
] as const;

beforeAll(async () => {
  owner = (await signUp("Trainer")).client;
  org = await createOrganization(owner, "Trainco");
  member = (await addMember(owner, org, "Tess")).client;
  const key = await owner.call<{ key: string }>("/api/auth/api-key/create", {
    body: { name: "ci", organizationId: org },
  });
  keyed = new Client(owner.environment, { "x-api-key": key.body.key });
});

describe("training is coming soon", () => {
  it.each(refusals)(
    "%s %s refuses with 501 coming_soon",
    async (method, path) => {
      for (const client of [owner, member, keyed]) {
        const res = await client.call(`/v1/orgs/${org}${path}`, {
          method,
          ...(method === "POST" && { body: {} }),
        });
        expect(res.status).toBe(501);
        expect(res.body).toEqual({
          error: { code: "coming_soon", message: "Training is coming soon." },
        });
      }
    },
  );

  it.each(refusals)(
    "%s %s needs a credential for the organization",
    async (method, path) => {
      const outsider = (await signUp("Outsider")).client;
      for (const [client, status] of [
        [new Client(owner.environment), 401],
        [outsider, 403],
      ] as const) {
        const res = await client.call(`/v1/orgs/${org}${path}`, {
          method,
          ...(method === "POST" && { body: {} }),
        });
        expect(res.status).toBe(status);
        expect(JSON.stringify(res.body)).not.toContain("coming_soon");
      }
    },
  );
});
