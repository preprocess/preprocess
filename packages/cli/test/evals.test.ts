import { describe, expect, it } from "vitest";

import { evalsList, evalsRun } from "../src/evals.ts";

const run = (model: string, status: string, passed = 0) => ({
  id: "evr_" + model,
  model,
  status,
  cases: 2,
  passed,
  failed: status === "completed" ? 2 - passed : 0,
  neededPerson: 0,
  passRate: status === "completed" ? passed / 2 : null,
  costUsd: 0.25,
});

describe("preprocess evals", () => {
  it("starts one run per model and waits for each to finish", async () => {
    const calls: string[] = [];
    let polls = 0;
    const fake = ((url: URL, init?: RequestInit) => {
      calls.push(
        (init?.method ?? "GET") +
          " " +
          url.pathname +
          (typeof init?.body === "string" ? " " + init.body : ""),
      );
      if (init?.method === "POST")
        return Promise.resolve(
          Response.json({ runs: [run("a", "running"), run("b", "running")] }),
        );
      polls++;
      const model = url.pathname.endsWith("evr_a") ? "a" : "b";
      return Promise.resolve(
        Response.json(
          polls > 2
            ? run(model, "completed", model === "a" ? 2 : 1)
            : run(model, "running"),
        ),
      );
    }) as typeof fetch;
    const { code, out } = await evalsRun({
      api: "https://api.test",
      org: "org_1",
      key: "pk",
      suite: "evs_1",
      models: ["a", "b"],
      pollMs: 1,
      fetch: fake,
    });
    expect(calls[0]).toBe(
      'POST /v1/orgs/org_1/eval-suites/evs_1/runs {"models":["a","b"]}',
    );
    expect(code).toBe(0);
    expect(out.split("\n").map((l) => l.replace(/\s+/g, " "))).toEqual([
      "a completed 100% passed (2/2) 0 failed 0 needed a person $0.2500",
      "b completed 50% passed (1/2) 1 failed 0 needed a person $0.2500",
    ]);
  });

  it("lists an agent's suites", async () => {
    const fake = (() =>
      Promise.resolve(
        Response.json({
          suites: [
            {
              id: "evs_1",
              name: "Completed cases",
              kind: "automatic",
              cap: 100,
              cases: 12,
              latestRun: run("a", "completed", 1),
            },
          ],
        }),
      )) as unknown as typeof fetch;
    const { out } = await evalsList({
      api: "https://api.test",
      org: "org_1",
      key: "pk",
      agent: "stock",
      fetch: fake,
    });
    expect(out.replace(/\s+/g, " ")).toBe(
      "evs_1 automatic 12 cases (cap 100) Completed cases latest: 50%",
    );
  });
});
