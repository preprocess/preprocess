import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bundle,
  deploy,
  describe as describeDeployment,
  entryPath,
  gitInfo,
} from "../src/deploy.ts";
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

  it("injects preprocess.config.json from the project root, or {} without one", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "preprocess-config-"));
    mkdirSync(path.join(root, "src"));
    const entry = path.join(root, "src/index.ts");
    writeFileSync(entry, "export default __PREPROCESS_CONFIG__;\n");
    writeFileSync(path.join(root, "package.json"), "{}");
    const evaluate = async () => {
      const code = (await bundle(entry)).modules["agent.js"]!;
      const url = `data:text/javascript,${encodeURIComponent(code)}`;
      return ((await import(url)) as { default: unknown }).default;
    };
    expect(await evaluate()).toEqual({});
    const config = {
      settings: { model: "kimi-k3.1-pro" },
      groups: [{ slug: "finance", name: "Finance" }],
    };
    writeFileSync(
      path.join(root, "preprocess.config.json"),
      JSON.stringify(config),
    );
    expect(await evaluate()).toEqual(config);
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

describe("entryPath", () => {
  it("names the entry from the git root, else from cwd", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "preprocess-entry-"));
    const project = path.join(dir, "agents/intake");
    mkdirSync(path.join(project, "src"), { recursive: true });
    writeFileSync(path.join(project, "src/index.ts"), "");
    expect(entryPath("src/index.ts", project)).toBe("src/index.ts");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    expect(entryPath("./src/index.ts", project)).toBe(
      "agents/intake/src/index.ts",
    );
  });
});

describe("deploy", () => {
  it("posts the bundle, git and entry to the agent's deployments with the key", async () => {
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
      entry: "agents/stock.ts",
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
      entry: "agents/stock.ts",
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

describe("describe", () => {
  it("names every grant a waiting deployment needs", () => {
    expect(
      describeDeployment("crm", {
        id: "dep_1",
        status: "waiting",
        environment: "production",
        production: false,
        waitingFor: { secrets: ["ERP_TOKEN"], mcp: ["crm"] },
        sdkVersion: "0.1.0",
        tools: [],
      }),
    ).toBe(
      "crm: deployment dep_1 is waiting for grants: secret ERP_TOKEN, MCP server crm",
    );
  });

  it("prints the agent's build warnings after the status", () => {
    expect(
      describeDeployment("crm", {
        id: "dep_1",
        status: "ready",
        environment: "preview",
        production: false,
        waitingFor: {},
        sdkVersion: "0.1.0",
        tools: [],
        warnings: ["group ops is not in preprocess.config.json's groups"],
      }),
    ).toBe(
      "crm: deployment dep_1 is ready (preview)\nwarning: group ops is not in preprocess.config.json's groups",
    );
  });
});

describe("main", () => {
  it("names what is missing instead of deploying", async () => {
    const result = await main(["deploy", fixture, "--agent", "stock"], {
      XDG_CONFIG_HOME: "/nonexistent",
    });
    expect(result.code).toBe(1);
    expect(result.out).toContain(
      "--org or PREPROCESS_ORG, --api or PREPROCESS_API_URL, a sign-in (preprocess login or PREPROCESS_API_KEY)",
    );
  });
});
