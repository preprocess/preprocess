// End-to-end check of a deployed stage, run on staging before production (and
// usable on any stage). OUTPUTS is the JSON scripts/stage.ts printed.
//
// 1. The API answers its health check and the app serves its sign-in page.
// 2. Auth round trip through the app's origin (the app forwards /api/auth to
//    the API): sign in as the stage's smoke-test user, signing up on the
//    first run, then read the session back.
// 3. In the smoke-test organization, deploy a stub agent (smoke-agent/agent.ts) and
//    run one case on it to completion.
//
// The user is reused across runs so each run sends no email. Its password is
// derived from the stage's BETTER_AUTH_SECRET, so it is never stored and
// differs per stage; its address is on EMAIL_FROM's domain, which receives the
// one verification email the first sign-up sends.

import { createHash } from "node:crypto";
import path from "node:path";

import { buildSync } from "esbuild";

const { app, api } = JSON.parse(process.env.OUTPUTS ?? "{}") as {
  app?: string;
  api?: string;
};
if (!app || !api) throw new Error("OUTPUTS must carry app and api URLs");
const stage = process.env.STAGE ?? "staging";
const authSecret = process.env.BETTER_AUTH_SECRET;
const emailFrom = process.env.EMAIL_FROM;
if (!authSecret || !emailFrom) {
  throw new Error("BETTER_AUTH_SECRET and EMAIL_FROM must be set");
}
const domain = /@([^>\s]+)>?\s*$/.exec(emailFrom)?.[1];
if (!domain) throw new Error("EMAIL_FROM has no address");
const email = `smoke-test+${stage}@${domain}`;
const password = createHash("sha256")
  .update(`${authSecret}:smoke-test`)
  .digest("hex");

const fail = (what: string): never => {
  throw new Error(`smoke test failed: ${what}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Session cookies, kept as a browser would for the app's origin.
const cookies = new Map<string, string>();
const call = async <T = unknown>(
  method: string,
  pathname: string,
  body?: unknown,
) => {
  const response = await fetch(new URL(pathname, app), {
    method,
    redirect: "manual",
    headers: {
      origin: new URL(app).origin,
      ...(cookies.size && {
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      }),
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  for (const header of response.headers.getSetCookie()) {
    const [pair = ""] = header.split(";");
    const at = pair.indexOf("=");
    if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const text = await response.text();
  console.log(`${method} ${pathname} -> ${response.status}`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, text, body: json as T };
};

// 1. Health. A new workers.dev subdomain can take a while to answer.
for (let attempt = 0; ; attempt++) {
  const status = await fetch(api)
    .then((r) => r.status)
    .catch(() => 0);
  if (status === 200) break;
  if (attempt > 30) fail(`API health check at ${api} never answered 200`);
  await sleep(2000);
}
console.log(`GET ${api} -> 200`);
const signInPage = await call("GET", "/sign-in");
if (signInPage.status !== 200 || !/<html/i.test(signInPage.text)) {
  fail("the app's sign-in page");
}

// 2. Auth round trip.
let signedIn = await call("POST", "/api/auth/sign-in/email", {
  email,
  password,
});
if (signedIn.status !== 200) {
  signedIn = await call("POST", "/api/auth/sign-up/email", {
    name: "Smoke test",
    email,
    password,
  });
}
if (signedIn.status !== 200) fail(`sign-in: ${signedIn.text}`);
const session = await call<{ user?: { id: string; email?: string } } | null>(
  "GET",
  "/api/auth/get-session",
);
const user = session.body?.user;
if (!user || user.email !== email) fail("the session after sign-in");

// 3. A case on a freshly deployed stub agent.
const orgs = await call<{ id: string; slug: string }[]>(
  "GET",
  "/api/auth/organization/list",
);
let org = orgs.body?.find((o) => o.slug.startsWith("smoke-test-"))?.id;
if (!org) {
  const created = await call<{ id: string }>(
    "POST",
    "/api/auth/organization/create",
    {
      name: "Smoke test",
      slug: `smoke-test-${crypto.randomUUID().slice(0, 8)}`,
    },
  );
  org = created.body?.id ?? fail(`creating the organization: ${created.text}`);
}

const built = buildSync({
  entryPoints: [path.join(import.meta.dirname, "../smoke-agent/agent.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2023",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["module", "main"],
  external: ["cloudflare:*", "node:*"],
  logLevel: "warning",
});
const deployed = await call<{ id: string; production: boolean }>(
  "POST",
  `/v1/orgs/${org}/agents/smoke/deployments`,
  {
    bundle: {
      mainModule: "agent.js",
      modules: { "agent.js": built.outputFiles[0]?.text ?? "" },
    },
    git: {
      branch: "main",
      commit: (process.env.GITHUB_SHA ?? "local").slice(0, 7),
    },
  },
);
if (deployed.status !== 201) fail(`deploying the agent: ${deployed.text}`);
if (!deployed.body.production) {
  const promoted = await call(
    "POST",
    `/v1/orgs/${org}/agents/smoke/deployments/${deployed.body.id}/promote`,
  );
  if (promoted.status !== 200) fail(`promoting the agent: ${promoted.text}`);
}

// Starting a case needs operator access, granted to a group the smoke-test
// user is in. Each call is idempotent, so later runs repeat it harmlessly.
const agent = await call<{ id: string }>("GET", `/v1/orgs/${org}/agents/smoke`);
if (agent.status !== 200) fail(`reading the agent: ${agent.text}`);
const groups = await call<{ id: string; slug: string }[]>(
  "GET",
  `/v1/orgs/${org}/groups`,
);
let group = groups.body?.find((g) => g.slug === "smoke-operators")?.id;
if (!group) {
  const created = await call<{ id: string }>("POST", `/v1/orgs/${org}/groups`, {
    name: "Smoke operators",
    slug: "smoke-operators",
  });
  group = created.body?.id ?? fail(`creating the group: ${created.text}`);
}
const member = await call(
  "PUT",
  `/v1/orgs/${org}/groups/${group}/members/${user!.id}`,
);
if (member.status >= 300) fail(`joining the group: ${member.text}`);
const grant = await call(
  "PUT",
  `/v1/orgs/${org}/agents/${agent.body.id}/grants/${group}`,
  { access: "operator" },
);
if (grant.status !== 200) fail(`granting operator access: ${grant.text}`);

const started = await call<{ id: string }>("POST", `/v1/orgs/${org}/cases`, {
  agent: "smoke",
  text: `Smoke test of ${stage}.`,
});
if (started.status !== 202) fail(`starting the case: ${started.text}`);
for (let attempt = 0; ; attempt++) {
  const state = await call<{ status: string }>(
    "GET",
    `/v1/orgs/${org}/cases/${started.body.id}`,
  );
  const status = state.body?.status;
  if (status === "completed") break;
  if (status === "failed" || status === "cancelled" || status === "halted") {
    fail(`the case ended ${status}: ${state.text}`);
  }
  if (attempt > 90) fail(`the case never completed (last: ${state.text})`);
  await sleep(2000);
}

console.log("smoke test passed");
