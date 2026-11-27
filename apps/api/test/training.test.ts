// Training (spec 12a, design doc 10) is Coming soon. The training switch
// decides how its routes answer: on (always on our cloud, TRAINING_SERVICE=on
// when self-hosted) they refuse with 501 coming_soon; off (a self-hosted
// install without the variable) they answer 404. GET /training tells any
// member which. Without a credential for the organization every route answers
// as any other org route does.

import { beforeAll, describe, expect, it } from "vitest";

import type { Env } from "../src/env.ts";
import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";

let org: string;
let owner: Client;
let member: Client;
let keyed: Client;

const selfHosted = (overrides: Partial<Env> = {}) =>
  testEnv({ PREPROCESS_REGION: undefined, ...overrides } as Partial<Env>);

// The same person or key, on another install's configuration.
const on = (client: Client, environment: Env) => {
  const moved = new Client(environment, client.headers);
  moved.cookie = client.cookie;
  return moved;
};

const refusals = [
  ["POST", "/training/runs"],
  ["POST", "/agents/invoices/retrain"],
  ["POST", "/training/tinker/api/v1/create_model"],
  ["GET", "/training/tinker/api/v1/get_server_capabilities"],
] as const;

const call = (client: Client, method: string, path: string) =>
  client.call(`/v1/orgs/${org}${path}`, {
    method,
    ...(method === "POST" && { body: {} }),
  });

beforeAll(async () => {
  owner = (await signUp("Trainer")).client;
  org = await createOrganization(owner, "Trainco");
  member = (await addMember(owner, org, "Tess")).client;
  const key = await owner.call<{ key: string }>("/api/auth/api-key/create", {
    body: { name: "ci", organizationId: org },
  });
  keyed = new Client(owner.environment, { "x-api-key": key.body.key });
});

describe("training switch", () => {
  it("is on in our cloud, whatever TRAINING_SERVICE says", async () => {
    for (const environment of [testEnv(), testEnv({ TRAINING_SERVICE: "off" })])
      for (const client of [owner, member, keyed]) {
        const res = await call(on(client, environment), "GET", "/training");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ service: "on", runs: "coming_soon" });
      }
  });

  it("is on when self-hosted only with TRAINING_SERVICE=on", async () => {
    for (const [environment, service] of [
      [selfHosted(), "off"],
      [selfHosted({ TRAINING_SERVICE: "yes" }), "off"],
      [selfHosted({ TRAINING_SERVICE: "on" }), "on"],
    ] as const)
      for (const client of [owner, member, keyed]) {
        const res = await call(on(client, environment), "GET", "/training");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ service, runs: "coming_soon" });
      }
  });

  it("GET /training needs a credential for the organization", async () => {
    const outsider = (await signUp("Outsider")).client;
    for (const [client, status] of [
      [new Client(owner.environment), 401],
      [outsider, 403],
    ] as const) {
      const res = await call(client, "GET", "/training");
      expect(res.status).toBe(status);
      expect(JSON.stringify(res.body)).not.toContain("coming_soon");
    }
  });

  it("describes the Training tag as off in the OpenAPI document when off", async () => {
    const tag = async (environment: Env) => {
      const res = await new Client(environment).call<{
        tags: { name: string; description: string }[];
      }>("/v1/openapi.json");
      return res.body.tags.find((t) => t.name === "Training")?.description;
    };
    expect(await tag(selfHosted())).toBe(
      "Training is off on this install. Its routes answer 404.",
    );
    for (const environment of [
      testEnv(),
      selfHosted({ TRAINING_SERVICE: "on" }),
    ])
      expect(await tag(environment)).toBe(
        "Training runs, Retrain on corrections and the Tinker-compatible API are coming soon.",
      );
  });
});

describe("training is coming soon", () => {
  it.each(refusals)(
    "%s %s refuses with 501 coming_soon when on",
    async (method, path) => {
      for (const environment of [
        testEnv(),
        selfHosted({ TRAINING_SERVICE: "on" }),
      ])
        for (const client of [owner, member, keyed]) {
          const res = await call(on(client, environment), method, path);
          expect(res.status).toBe(501);
          expect(res.body).toEqual({
            error: { code: "coming_soon", message: "Training is coming soon." },
          });
        }
    },
  );

  it.each(refusals)(
    "%s %s answers 404 not_found when off",
    async (method, path) => {
      for (const client of [owner, member, keyed]) {
        const res = await call(on(client, selfHosted()), method, path);
        expect(res.status).toBe(404);
        expect(res.body).toEqual({
          error: {
            code: "not_found",
            message: "Training is off on this install.",
          },
        });
      }
    },
  );

  it.each(refusals)(
    "%s %s needs a credential for the organization",
    async (method, path) => {
      const outsider = (await signUp("Outsider")).client;
      for (const environment of [testEnv(), selfHosted()])
        for (const [client, status] of [
          [new Client(environment), 401],
          [on(outsider, environment), 403],
        ] as const) {
          const res = await call(client, method, path);
          expect(res.status).toBe(status);
          expect(JSON.stringify(res.body)).not.toContain("coming_soon");
          expect(JSON.stringify(res.body)).not.toContain("Training is off");
        }
    },
  );
});
