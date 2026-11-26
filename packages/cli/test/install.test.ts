import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkInstallEnv, install, type Run } from "../src/install.ts";

const ready = {
  CLOUDFLARE_API_TOKEN: "cf-token",
  CLOUDFLARE_ACCOUNT_ID: "account",
  DATABASE_URL: "postgres://admin:pw@db.example.com/preprocess",
  EMAIL_FROM: "Preprocess <invites@example.com>",
  BASETEN_API_KEY: "baseten-key",
};

const checkout = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "preprocess-source-"));
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ packageManager: "pnpm@10.14.0" }),
  );
  return dir;
};

const recorder = () => {
  const calls: {
    command: string;
    args: string[];
    cwd: string;
    token?: string | undefined;
  }[] = [];
  const run: Run = (command, args, { cwd, env }) => {
    calls.push({ command, args, cwd, token: env.CLOUDFLARE_API_TOKEN });
    if (command === "tar")
      writeFileSync(
        path.join(cwd, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.14.0" }),
      );
    return Promise.resolve(0);
  };
  return { calls, run };
};

describe("preprocess install", () => {
  it("lists every missing input, and refuses our cloud's run mode", () => {
    expect(
      checkInstallEnv({
        PREPROCESS_REGION: "us",
        MODEL_SERVICE_URL: "https://m",
      }),
    ).toEqual([
      "CLOUDFLARE_API_TOKEN is not set",
      "CLOUDFLARE_ACCOUNT_ID is not set",
      "DATABASE_URL is not set",
      "EMAIL_FROM is not set",
      "MODEL_SERVICE_KEY is not set",
      "PREPROCESS_REGION is set; it marks a deploy as Preprocess's own cloud, so unset it",
    ]);
    expect(
      checkInstallEnv({
        ...ready,
        MODEL_SERVICE_URL: "stub",
        MODEL_SERVICE_KEY: undefined,
      }),
    ).toEqual([]);
  });

  it("deploys the self-hosted stage from a checkout with its own pnpm", async () => {
    const source = checkout();
    const { calls, run } = recorder();
    const result = await install({
      stage: "selfhost-eu",
      plan: false,
      source,
      envFiles: [],
      env: ready,
      run,
    });
    expect(result.code).toBe(0);
    expect(calls).toEqual([
      {
        command: "npx",
        args: ["--yes", "pnpm@10.14.0", "install", "--frozen-lockfile"],
        cwd: source,
        token: "cf-token",
      },
      {
        command: "npx",
        args: [
          "--yes",
          "pnpm@10.14.0",
          "--filter",
          "@preprocess/infra",
          "selfhost:deploy",
          "selfhost-eu",
        ],
        cwd: source,
        token: "cf-token",
      },
    ]);
  });

  it("downloads the latest release once and plans from it", async () => {
    const cache = mkdtempSync(path.join(tmpdir(), "preprocess-cache-"));
    const urls: string[] = [];
    const fake = ((url: string) => {
      urls.push(url);
      return Promise.resolve(
        url.endsWith("/releases/latest")
          ? Response.json({ tag_name: "v0.2.0" })
          : new Response("tarball"),
      );
    }) as typeof fetch;
    const { calls, run } = recorder();
    const options = {
      stage: "selfhost",
      plan: true,
      envFiles: [],
      env: { ...ready, XDG_CACHE_HOME: cache },
      run,
      fetch: fake,
    };
    expect((await install(options)).out).toBe(
      "Planned selfhost. Nothing was changed.",
    );
    await install(options);
    expect(urls).toEqual([
      "https://api.github.com/repos/preprocess/preprocess/releases/latest",
      "https://codeload.github.com/preprocess/preprocess/tar.gz/refs/tags/v0.2.0",
      "https://api.github.com/repos/preprocess/preprocess/releases/latest",
    ]);
    const source = path.join(cache, "preprocess", "releases", "v0.2.0");
    expect(calls.filter((c) => c.command === "tar")).toHaveLength(1);
    expect(calls.at(-1)?.args.slice(2)).toEqual([
      "--filter",
      "@preprocess/infra",
      "selfhost:plan",
      "selfhost",
    ]);
    expect(calls.at(-1)?.cwd).toBe(source);
  });

  it("reads inputs from env files, later files winning", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "preprocess-env-"));
    const base = path.join(dir, ".env");
    const app = path.join(dir, ".env.github-app");
    writeFileSync(
      base,
      Object.entries(ready)
        .map(([k, v]) => `${k}="${v}"`)
        .join("\n"),
    );
    writeFileSync(app, "CLOUDFLARE_API_TOKEN=from-second-file\n");
    const { calls, run } = recorder();
    const result = await install({
      stage: "selfhost",
      plan: false,
      source: checkout(),
      envFiles: [base, app],
      env: {},
      run,
    });
    expect(result.code).toBe(0);
    expect(calls[0]?.token).toBe("from-second-file");
    expect(readFileSync(base, "utf8")).toContain("DATABASE_URL");
  });

  it("refuses a stage that is not a self-hosted one", async () => {
    const result = await install({
      stage: "production",
      plan: false,
      envFiles: [],
      env: ready,
    });
    expect(result.code).toBe(1);
    expect(result.out).toContain("--stage must be selfhost");
  });
});
