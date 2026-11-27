import { describe, expect, it } from "vitest";

import { promote, rollback } from "../src/promote.ts";

const deployment = (id: string, promotedAt: string | null, commit: string) => ({
  id,
  status: "ready",
  environment: "production",
  production: false,
  waitingFor: {},
  sdkVersion: "0.1.0",
  tools: [],
  warnings: [],
  promotedAt,
  git: { branch: "main", commit },
});

const api = (list: unknown[]) => {
  const calls: string[] = [];
  const fake = ((url: URL, init: RequestInit = {}) => {
    calls.push(`${init.method} ${url.pathname}${url.search}`);
    if (init.method === "POST") {
      const id = url.pathname.split("/").at(-2)!;
      return Promise.resolve(
        Response.json({ ...deployment(id, "now", "x"), production: true }),
      );
    }
    return Promise.resolve(Response.json(list));
  }) as typeof fetch;
  return { fake, calls };
};

const target = (fake: typeof fetch) => ({
  api: "https://app.test",
  org: "org_1",
  key: "sess_1",
  agent: "stock",
  fetch: fake,
});

describe("preprocess promote", () => {
  it("promotes the named deployment", async () => {
    const { fake, calls } = api([]);
    const result = await promote({ ...target(fake), deployment: "dep_2" });
    expect(calls).toEqual([
      "POST /v1/orgs/org_1/agents/stock/deployments/dep_2/promote",
    ]);
    expect(result.out).toBe(
      "stock: deployment dep_2 is ready (serving production)",
    );
  });

  it("reports the API's refusal", async () => {
    const fake = (() =>
      Promise.resolve(
        Response.json(
          {
            error: {
              message:
                "only a deployment from the production branch can be promoted",
            },
          },
          { status: 409 },
        ),
      )) as typeof fetch;
    await expect(
      promote({ ...target(fake), deployment: "dep_preview" }),
    ).rejects.toThrow(
      "POST deployments/dep_preview/promote failed (409): only a deployment from the production branch can be promoted",
    );
  });
});

describe("preprocess rollback", () => {
  it("promotes the deployment that served production before the current one", async () => {
    const { fake, calls } = api([
      deployment("dep_4", null, "4444444"),
      deployment("dep_3", "2026-11-27T10:00:00Z", "3333333"),
      deployment("dep_2", null, "2222222"),
      deployment("dep_1", "2026-11-26T10:00:00Z", "1111111abc"),
    ]);
    const result = await rollback(target(fake));
    expect(calls).toEqual([
      "GET /v1/orgs/org_1/agents/stock/deployments?environment=production",
      "POST /v1/orgs/org_1/agents/stock/deployments/dep_1/promote",
    ]);
    expect(result.out).toBe(
      "Rolling stock back from dep_3 to dep_1 (1111111).\nstock: deployment dep_1 is ready (serving production)",
    );
  });

  it("promotes a named deployment instead", async () => {
    const { fake, calls } = api([]);
    await rollback({ ...target(fake), deployment: "dep_0" });
    expect(calls).toEqual([
      "POST /v1/orgs/org_1/agents/stock/deployments/dep_0/promote",
    ]);
  });

  it("says when there is nothing to roll back to", async () => {
    const { fake } = api([deployment("dep_1", "2026-11-26T10:00:00Z", "1")]);
    expect(await rollback(target(fake))).toEqual({
      code: 1,
      out: "stock has no earlier production deployment to roll back to.",
    });
  });
});
