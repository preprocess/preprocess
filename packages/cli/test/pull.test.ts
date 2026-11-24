import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { configPull, groupsPull } from "../src/pull.ts";
import { main } from "../src/main.ts";

const project = (config?: unknown) => {
  const root = mkdtempSync(path.join(tmpdir(), "preprocess-pull-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "package.json"), "{}");
  if (config)
    writeFileSync(
      path.join(root, "preprocess.config.json"),
      JSON.stringify(config),
    );
  return {
    root,
    entry: path.join(root, "src/index.ts"),
    read: () =>
      JSON.parse(
        readFileSync(path.join(root, "preprocess.config.json"), "utf8"),
      ) as unknown,
  };
};

const serve = (routes: Record<string, unknown>) => {
  const calls: { url: string; authorization: string | null }[] = [];
  const fake = ((url: URL, init?: RequestInit) => {
    calls.push({
      url: url.toString(),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    const route = Object.keys(routes).find((r) => url.pathname.endsWith(r));
    return Promise.resolve(
      route
        ? Response.json(routes[route])
        : Response.json({ error: "not found" }, { status: 404 }),
    );
  }) as typeof fetch;
  return { calls, fake };
};

const options = (entry: string, fake: typeof fetch) => ({
  api: "https://api.test",
  org: "org_1",
  key: "pk_test",
  entry,
  fetch: fake,
});

describe("config pull", () => {
  it("writes only dashboard overrides into settings and keeps groups", async () => {
    const p = project({
      settings: {
        model: "inkling-2-mini",
        ocr: true,
        evals: { onPush: false },
      },
      groups: [{ slug: "finance", name: "Finance" }],
    });
    const { calls, fake } = serve({
      "/agents/invoices/settings": {
        settings: [
          { key: "model", value: "kimi-k3.1-pro", source: "override" },
          { key: "reasoning", value: "medium", source: "default" },
          { key: "ocr", value: true, source: "code" },
          { key: "evals.onPush", value: true, source: "override" },
          { key: "schedules.daily.previews", value: true, source: "override" },
        ],
      },
    });
    const result = await configPull({
      ...options(p.entry, fake),
      agent: "invoices",
    });
    expect(calls).toEqual([
      {
        url: "https://api.test/v1/orgs/org_1/agents/invoices/settings",
        authorization: "Bearer pk_test",
      },
    ]);
    expect(p.read()).toEqual({
      settings: {
        model: "kimi-k3.1-pro",
        ocr: true,
        evals: { onPush: true },
        schedules: { daily: { previews: true } },
      },
      groups: [{ slug: "finance", name: "Finance" }],
    });
    expect(result.out).toContain(
      "model, evals.onPush, schedules.daily.previews",
    );
  });

  it("creates the file beside package.json when there is none", async () => {
    const p = project();
    const { fake } = serve({
      "/agents/invoices/settings": {
        settings: [{ key: "reasoning", value: "high", source: "override" }],
      },
    });
    const result = await configPull({
      ...options(p.entry, fake),
      agent: "invoices",
    });
    expect(result.file).toBe(path.join(p.root, "preprocess.config.json"));
    expect(p.read()).toEqual({ settings: { reasoning: "high" } });
  });
});

describe("groups pull", () => {
  it("replaces only groups", async () => {
    const p = project({
      settings: { model: "kimi-k3.1-pro" },
      groups: [{ slug: "old", name: "Old" }],
    });
    const { fake } = serve({
      "/groups": [
        { slug: "ap-team", name: "AP team", description: "Payables" },
        { slug: "developers", name: "Developers", description: null },
      ],
    });
    const result = await groupsPull(options(p.entry, fake));
    expect(p.read()).toEqual({
      settings: { model: "kimi-k3.1-pro" },
      groups: [
        { slug: "ap-team", name: "AP team", description: "Payables" },
        { slug: "developers", name: "Developers" },
      ],
    });
    expect(result.out).toBe(
      `Wrote 2 groups to ${path.join(p.root, "preprocess.config.json")}.`,
    );
  });
});

describe("main", () => {
  it("needs an agent for config pull but not for groups pull", async () => {
    const env = {
      PREPROCESS_ORG: "org_1",
      PREPROCESS_API_URL: "https://api.test",
      PREPROCESS_API_KEY: "pk",
    };
    const config = await main(["config", "pull", "x.ts", "--agent", ""], env);
    expect(config.code).toBe(1);
    expect(config.out).toContain("--agent");
    expect((await main(["groups"], env)).code).toBe(1);
  });
});
