import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  credentialsPath,
  resolveTarget,
  writeCredentials,
} from "../src/credentials.ts";
import type { Credentials } from "../src/credentials.ts";
import { login } from "../src/login.ts";

const code = {
  device_code: "dev_1",
  user_code: "ABCD1234",
  verification_uri: "https://app.test/device",
  verification_uri_complete: "https://app.test/device?user_code=ABCD1234",
  interval: 5,
  expires_in: 900,
};

// A Better Auth install that answers the device flow: pending, then the
// given answer to every poll.
const server = (
  polls: Array<{ status: number; body: unknown }>,
  orgs = [{ id: "org_1", name: "Acme", slug: "acme" }],
) => {
  const calls: Array<{ url: string; body?: unknown; auth?: string | null }> =
    [];
  const fake = ((url: URL, init: RequestInit = {}) => {
    const auth = new Headers(init.headers).get("authorization");
    calls.push({
      url: url.toString(),
      body: init.body ? JSON.parse(init.body as string) : undefined,
      auth,
    });
    const route = url.pathname;
    if (route === "/api/auth/device/code")
      return Promise.resolve(Response.json(code));
    if (route === "/api/auth/device/token") {
      const next = polls.shift()!;
      return Promise.resolve(Response.json(next.body, { status: next.status }));
    }
    if (route === "/api/auth/get-session")
      return Promise.resolve(
        Response.json({ user: { email: "ada@acme.test" } }),
      );
    if (route === "/api/auth/organization/list")
      return Promise.resolve(Response.json(orgs));
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as typeof fetch;
  return { fake, calls };
};

const pending = { status: 400, body: { error: "authorization_pending" } };
const granted = { status: 200, body: { access_token: "sess_1" } };

const run = (
  fake: typeof fetch,
  org?: string,
  saved: Credentials[] = [],
  waits: number[] = [],
) => {
  const lines: string[] = [];
  const opened: string[] = [];
  return login({
    api: "https://app.test",
    org,
    fetch: fake,
    log: (line) => lines.push(line),
    open: (url) => opened.push(url),
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    save: (credentials) => {
      saved.push(credentials);
      return "/home/ada/.config/preprocess/credentials.json";
    },
  }).then((result) => ({ ...result, lines, opened, saved }));
};

describe("preprocess login", () => {
  it("prints the code, opens the browser, polls until approved and saves the session", async () => {
    const { fake, calls } = server([pending, granted]);
    const waits: number[] = [];
    const result = await run(fake, undefined, [], waits);
    expect(result.lines).toEqual([
      "Your code: ABCD1234",
      "Approve it at https://app.test/device?user_code=ABCD1234",
    ]);
    expect(result.opened).toEqual([code.verification_uri_complete]);
    expect(waits).toEqual([5000, 5000]);
    expect(calls[0]).toMatchObject({
      url: "https://app.test/api/auth/device/code",
      body: { client_id: "preprocess-cli" },
    });
    expect(calls[1]!.body).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "dev_1",
      client_id: "preprocess-cli",
    });
    expect(calls.at(-1)!.auth).toBe("Bearer sess_1");
    expect(result.saved).toEqual([
      {
        api: "https://app.test",
        token: "sess_1",
        email: "ada@acme.test",
        org: "org_1",
      },
    ]);
    expect(result.out).toBe(
      "Signed in as ada@acme.test to Acme (org_1). Saved to /home/ada/.config/preprocess/credentials.json.",
    );
  });

  it("slows down when asked to", async () => {
    const { fake } = server([
      { status: 400, body: { error: "slow_down" } },
      granted,
    ]);
    const waits: number[] = [];
    await run(fake, undefined, [], waits);
    expect(waits).toEqual([5000, 10000]);
  });

  it("asks for --org when the person is in several organizations", async () => {
    const orgs = [
      { id: "org_1", name: "Acme", slug: "acme" },
      { id: "org_2", name: "Globex", slug: "globex" },
    ];
    const several = await run(server([granted], orgs).fake);
    expect(several.saved[0]!.org).toBeUndefined();
    expect(several.out).toContain(
      "Choose an organization with --org or PREPROCESS_ORG:\n  org_1  Acme\n  org_2  Globex",
    );
    const chosen = await run(server([granted], orgs).fake, "globex");
    expect(chosen.saved[0]!.org).toBe("org_2");
    await expect(run(server([granted], orgs).fake, "initech")).rejects.toThrow(
      "You aren't a member of initech.",
    );
  });

  it("stops when the code is denied or expires", async () => {
    await expect(
      run(server([{ status: 400, body: { error: "access_denied" } }]).fake),
    ).rejects.toThrow("Sign-in was denied in the browser.");
    await expect(
      run(server([{ status: 400, body: { error: "expired_token" } }]).fake),
    ).rejects.toThrow("The code expired. Run preprocess login again.");
  });
});

describe("saved credentials", () => {
  it("are readable only by the user, and lose to the environment and flags", () => {
    const env = { XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "pp-")) };
    const file = writeCredentials(env, {
      api: "https://app.test",
      token: "sess_1",
      org: "org_1",
    });
    expect(file).toBe(credentialsPath(env));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      token: "sess_1",
    });

    expect(resolveTarget({}, env)).toEqual({
      api: "https://app.test",
      org: "org_1",
      key: "sess_1",
    });
    expect(
      resolveTarget({ org: "org_9" }, { ...env, PREPROCESS_API_KEY: "pp_ci" }),
    ).toEqual({ api: "https://app.test", org: "org_9", key: "pp_ci" });
    // A session is never sent to an API other than the one that issued it.
    expect(resolveTarget({ api: "https://other.test" }, env)).toEqual({
      api: "https://other.test",
      org: undefined,
      key: undefined,
    });
  });
});
