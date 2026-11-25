import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

import { describe, expect, it } from "vitest";

import { envFile, githubApp, manifest } from "../src/github-app.ts";

const pkcs1 = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();

const conversion = {
  id: 42,
  slug: "preprocess-acme",
  client_id: "Iv1.abc",
  client_secret: "client-secret",
  webhook_secret: "webhook-secret",
  pem: pkcs1,
};

describe("preprocess github-app", () => {
  it("asks for the App design doc 08 describes", () => {
    expect(
      manifest({
        appUrl: "https://preprocess.acme.com/",
        name: "Preprocess",
        redirectUrl: "http://127.0.0.1:1/callback",
      }),
    ).toEqual({
      name: "Preprocess",
      url: "https://preprocess.acme.com",
      hook_attributes: {
        url: "https://preprocess.acme.com/v1/github/webhook",
        active: true,
      },
      redirect_url: "http://127.0.0.1:1/callback",
      callback_urls: ["https://preprocess.acme.com/v1/github/setup"],
      setup_url: "https://preprocess.acme.com/v1/github/setup",
      setup_on_update: true,
      request_oauth_on_install: true,
      public: true,
      default_permissions: { contents: "read", metadata: "read" },
      default_events: ["push"],
    });
  });

  it("writes the six values with the key in PKCS #8", () => {
    const values = parseEnv(envFile(conversion));
    expect(Object.keys(values).sort()).toEqual([
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_SLUG",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "GITHUB_WEBHOOK_SECRET",
    ]);
    expect(values.GITHUB_APP_PRIVATE_KEY).toMatch(
      /^-----BEGIN PRIVATE KEY-----\n/,
    );
    expect(
      createPrivateKey(values.GITHUB_APP_PRIVATE_KEY!).export({
        type: "pkcs1",
        format: "pem",
      }),
    ).toBe(pkcs1);
  });

  it("serves the manifest, then exchanges GitHub's code for the App", async () => {
    const out = path.join(
      mkdtempSync(path.join(tmpdir(), "github-app-")),
      ".env.github-app",
    );
    const exchanged: string[] = [];
    const fake = ((url: string) => {
      exchanged.push(url);
      return Promise.resolve(Response.json(conversion, { status: 201 }));
    }) as typeof fetch;
    let started!: (line: string) => void;
    const opened = new Promise<string>((resolve) => (started = resolve));
    const done = githubApp({
      appUrl: "https://preprocess.acme.com",
      name: "Preprocess",
      owner: "acme",
      out,
      log: started,
      fetch: fake,
    });
    const origin = /http:\/\/127\.0\.0\.1:\d+/.exec(await opened)![0];
    const html = await (await fetch(`${origin}/`)).text();
    const state = /apps\/new\?state=([0-9a-f]+)/.exec(html)![1]!;
    expect(html).toContain(
      'action="https://github.com/organizations/acme/settings/apps/new?state=',
    );
    expect(html).toContain(
      `&quot;redirect_url&quot;:&quot;${origin}/callback&quot;`,
    );
    expect(
      (await fetch(`${origin}/callback?code=c0de&state=wrong`)).status,
    ).toBe(404);
    expect(
      (await fetch(`${origin}/callback?code=c0de&state=${state}`)).status,
    ).toBe(200);
    const result = await done;
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("client-secret");
    expect(exchanged).toEqual([
      "https://api.github.com/app-manifests/c0de/conversions",
    ]);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(parseEnv(readFileSync(out, "utf8")).GITHUB_APP_ID).toBe("42");
  });
});
