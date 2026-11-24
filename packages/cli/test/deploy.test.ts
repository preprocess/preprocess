import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { bundle, deploy, gitInfo } from "../src/deploy.ts";
import { main } from "../src/main.ts";

const fixture = path.join(import.meta.dirname, "fixtures/agent.ts");

describe("bundle", () => {
  it("makes one self-contained ES module from an SDK agent", async () => {
    const b = await bundle(fixture);
    expect(b.mainModule).toBe("agent.js");
    const code = b.modules["agent.js"]!;
    expect(code).toContain("lookup_stock");
    expect(code).toMatch(/export\s*\{[^}]*default/);
    for (const [, specifier] of code.matchAll(/\bfrom\s*"([^"]+)"/g))
      expect(specifier).toMatch(/^(cloudflare|node):/);
  });
});

describe("gitInfo", () => {
  it("reads the branch and commit of the checkout", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "preprocess-cli-"));
    const run = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    run("init", "-q", "-b", "release");
    run(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    );
    expect(gitInfo(dir, {})).toEqual({
      branch: "release",
      commit: run("rev-parse", "HEAD"),
    });
    run("checkout", "-q", "--detach");
    expect(gitInfo(dir, { GITHUB_HEAD_REF: "feature" }).branch).toBe("feature");
  });
});

describe("deploy", () => {
  it("posts the bundle and git to the agent's deployments with the key", async () => {
    let seen: Request | undefined;
    const fake = ((input: URL, init: RequestInit) => {
      seen = new Request(input, init);
      return Promise.resolve(
        Response.json(
          {
            id: "dep_1",
            status: "ready",
            environment: "production",
            production: true,
            waitingFor: {},
            sdkVersion: "0.1.0",
            tools: [],
          },
          { status: 201 },
        ),
      );
    }) as typeof fetch;
    const b = {
      mainModule: "agent.js",
      modules: { "agent.js": "export default {}" },
    };
    const d = await deploy({
      api: "https://api.test/base",
      org: "org_1",
      agent: "stock",
      key: "pp_k",
      bundle: b,
      git: { branch: "main", commit: "abc" },
      fetch: fake,
    });
    expect(d.id).toBe("dep_1");
    expect(seen!.url).toBe(
      "https://api.test/base/v1/orgs/org_1/agents/stock/deployments",
    );
    expect(seen!.headers.get("authorization")).toBe("Bearer pp_k");
    expect(await seen!.json()).toEqual({
      bundle: b,
      git: { branch: "main", commit: "abc" },
    });
  });

  it("reports the API's error", async () => {
    const fake = (() =>
      Promise.resolve(
        Response.json({ error: "agent name must match" }, { status: 400 }),
      )) as unknown as typeof fetch;
    await expect(
      deploy({
        api: "https://api.test",
        org: "o",
        agent: "Bad",
        key: "k",
        bundle: { mainModule: "a", modules: { a: "" } },
        git: {},
        fetch: fake,
      }),
    ).rejects.toThrow("deploy failed (400): agent name must match");
  });
});

describe("main", () => {
  it("names what is missing instead of deploying", async () => {
    const result = await main(["deploy", fixture, "--agent", "stock"], {});
    expect(result.code).toBe(1);
    expect(result.out).toContain(
      "--org or PREPROCESS_ORG, --api or PREPROCESS_API_URL, PREPROCESS_API_KEY",
    );
  });
});
