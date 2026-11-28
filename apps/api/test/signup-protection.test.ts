import { withoutOrg } from "@preprocess/db/client";
import { user } from "@preprocess/db/schema/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isDisposable,
  SIGN_IN_LINKS_PER_HOUR,
  TURNSTILE_HEADER,
} from "../src/signup-protection.ts";
import {
  Client,
  createOrganization,
  sent,
  signUp,
  testEnv,
  tracked,
  unique,
} from "./helpers.ts";

const SECRET = "1x0000000000000000000000000000000AA";
// Events are queued only where a PostHog key is set.
const analytics = { POSTHOG_KEY: "phc_test", STAGE: "test" };
const address = (domain = "example.test") => `${unique("person")}@${domain}`;

const ask = (client: Client, email: string) =>
  client.call<{ code?: string; message?: string }>(
    "/api/auth/sign-in/magic-link",
    { body: { email, callbackURL: "/" } },
  );

const mailedTo = (email: string) => sent.filter((m) => m.to === email).length;

const blocked = (reason: string) =>
  tracked.filter(
    (event) =>
      event.event === "signup_blocked" && event.properties.reason === reason,
  );

// Siteverify accepts the one token "good" and records what it was sent.
const siteverify = () => {
  const calls: FormData[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "challenges.cloudflare.com")
      throw new Error("unexpected fetch to " + url.hostname);
    const form = init?.body as FormData;
    calls.push(form);
    return Response.json({ success: form.get("response") === "good" });
  });
  return calls;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the bot check on sign-in links", () => {
  it("sends no link without a token or with a rejected one", async () => {
    siteverify();
    const environment = testEnv({
      ...analytics,
      SIGN_IN_TURNSTILE_SECRET: SECRET,
    });
    const email = address();
    const before = blocked("bot").length;

    const missing = await ask(new Client(environment), email);
    expect(missing.status).toBe(403);
    expect(missing.body.code).toBe("BOT_CHECK_FAILED");
    expect(missing.body.message).toBe(
      "We couldn't confirm you're a person. Complete the check and try again.",
    );

    const rejected = await ask(
      new Client(environment, { [TURNSTILE_HEADER]: "bad" }),
      email,
    );
    expect(rejected.status).toBe(403);
    expect(mailedTo(email)).toBe(0);
    expect(blocked("bot").length - before).toBe(2);
  });

  it("sends the link once Turnstile accepts the token", async () => {
    const calls = siteverify();
    const environment = testEnv({
      ...analytics,
      SIGN_IN_TURNSTILE_SECRET: SECRET,
    });
    const email = address();
    const asked = await ask(
      new Client(environment, {
        [TURNSTILE_HEADER]: "good",
        "cf-connecting-ip": "203.0.113.7",
      }),
      email,
    );
    expect(asked.status).toBe(200);
    expect(mailedTo(email)).toBe(1);
    expect(calls.at(-1)?.get("secret")).toBe(SECRET);
    expect(calls.at(-1)?.get("remoteip")).toBe("203.0.113.7");
  });

  it("is off where no secret is set", async () => {
    const email = address();
    expect((await ask(new Client(testEnv()), email)).status).toBe(200);
    expect(mailedTo(email)).toBe(1);
  });
});

describe("temporary inboxes", () => {
  it("can't sign up, at a listed domain or below it", async () => {
    const before = blocked("disposable").length;
    for (const email of [
      address("mailinator.com"),
      address("x.mailinator.com"),
    ]) {
      const asked = await ask(new Client(testEnv(analytics)), email);
      expect(asked.status).toBe(403);
      expect(asked.body.code).toBe("DISPOSABLE_EMAIL");
      expect(asked.body.message).toBe(
        "Use a permanent email address. Temporary inboxes can't sign up.",
      );
      expect(mailedTo(email)).toBe(0);
    }
    expect(blocked("disposable").length - before).toBe(2);
  });

  it("still signs in an account that already has one", async () => {
    const environment = testEnv(analytics);
    const email = address("mailinator.com");
    await withoutOrg(environment, "test fixture", (tx) =>
      tx.insert(user).values({
        id: unique("user"),
        name: "Old Account",
        email,
        emailVerified: true,
      }),
    );
    expect((await ask(new Client(environment), email)).status).toBe(200);
  });

  it("lets plus-addresses and allowed domains through", () => {
    expect(isDisposable("ada+preprocess@example.test")).toBe(false);
    expect(isDisposable("ada@mailinator.com")).toBe(true);
    expect(
      isDisposable("ada@mailinator.com", new Set(["mailinator.com"])),
    ).toBe(false);
  });

  it("can't be invited", async () => {
    const { client } = await signUp("Owner");
    await createOrganization(client, "Inviters");
    const invited = await client.call<{ code?: string }>(
      "/api/auth/organization/invite-member",
      { body: { email: address("mailinator.com"), role: "member" } },
    );
    expect(invited.status).toBe(400);
    expect(invited.body.code).toBe("DISPOSABLE_EMAIL");
  });
});

describe("sign-in links per address", () => {
  it("sends at most the hour's links, counting plus-addresses as one", async () => {
    const before = blocked("rate_limited").length;
    const local = unique("busy");
    for (let i = 0; i < SIGN_IN_LINKS_PER_HOUR; i++)
      expect(
        (
          await ask(
            new Client(testEnv(analytics)),
            `${local}+${i}@example.test`,
          )
        ).status,
      ).toBe(200);
    const over = await ask(
      new Client(testEnv(analytics)),
      `${local}@example.test`,
    );
    expect(over.status).toBe(429);
    expect(over.body.code).toBe("TOO_MANY_LINKS");
    expect(over.body.message).toBe(
      "Too many sign-in links for this address. Try again later.",
    );
    expect(mailedTo(`${local}@example.test`)).toBe(0);
    expect(blocked("rate_limited").length - before).toBe(1);
  });
});

describe("the signup_blocked event", () => {
  it("carries the reason and stage, never the address or its domain", async () => {
    const email = address("mailinator.com");
    await ask(new Client(testEnv(analytics)), email);
    const event = blocked("disposable").at(-1)!;
    expect(Object.keys(event.properties).sort()).toEqual(
      ["$geoip_disable", "reason", "service", "stage"].sort(),
    );
    expect(JSON.stringify(event)).not.toContain("mailinator");
  });
});
