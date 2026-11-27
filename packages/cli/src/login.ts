// `preprocess login`: the OAuth device flow (RFC 8628) against the
// install's own Better Auth. The CLI asks for a code, the person approves it
// in the app at /device, and the CLI saves the session it is given. That
// session acts as the person, with their role in each organization.

import { spawn } from "node:child_process";

import type { Credentials } from "./credentials.ts";

export const CLIENT_ID = "preprocess-cli";
const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export type LoginOptions = {
  api: string;
  org?: string | undefined;
  browser?: boolean;
  fetch?: typeof fetch;
  log: (line: string) => void;
  save: (credentials: Credentials) => string;
  open?: (url: string) => void;
  sleep?: (ms: number) => Promise<void>;
};

type Code = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
};

type Organization = { id: string; name: string; slug: string };

const openBrowser = (url: string) => {
  const [command, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    spawn(command, args, { stdio: "ignore", detached: true })
      .on("error", () => undefined)
      .unref();
  } catch {
    // No browser here; the printed URL is enough.
  }
};

export const login = async (options: LoginOptions) => {
  const send = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const base = options.api.endsWith("/") ? options.api : options.api + "/";
  const auth = (route: string, init: RequestInit = {}) =>
    send(new URL("api/auth/" + route, base), {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });

  const asked = await auth("device/code", {
    method: "POST",
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!asked.ok)
    throw new Error(
      `${options.api} didn't start sign-in (${asked.status}). Check --api or PREPROCESS_API_URL.`,
    );
  const code = (await asked.json()) as Code;
  options.log(`Your code: ${code.user_code}`);
  options.log(`Approve it at ${code.verification_uri_complete}`);
  if (options.browser !== false)
    (options.open ?? openBrowser)(code.verification_uri_complete);

  let interval = code.interval * 1000;
  const deadline = Date.now() + code.expires_in * 1000;
  let token: string | undefined;
  while (!token) {
    if (Date.now() > deadline)
      throw new Error("The code expired. Run preprocess login again.");
    await sleep(interval);
    const polled = await auth("device/token", {
      method: "POST",
      body: JSON.stringify({
        grant_type: GRANT,
        device_code: code.device_code,
        client_id: CLIENT_ID,
      }),
    });
    const body = (await polled.json()) as {
      access_token?: string;
      error?: string;
    };
    if (polled.ok && body.access_token) token = body.access_token;
    else if (body.error === "slow_down") interval += 5000;
    else if (body.error === "access_denied")
      throw new Error("Sign-in was denied in the browser.");
    else if (body.error === "expired_token")
      throw new Error("The code expired. Run preprocess login again.");
    else if (body.error !== "authorization_pending")
      throw new Error(`Sign-in failed (${polled.status}): ${body.error}`);
  }

  const bearer = { authorization: `Bearer ${token}` };
  const session = (await (
    await auth("get-session", { headers: bearer })
  ).json()) as { user?: { email: string } } | null;
  const orgs = (await (
    await auth("organization/list", { headers: bearer })
  ).json()) as Organization[];

  const chosen = options.org
    ? orgs.find((o) => o.id === options.org || o.slug === options.org)
    : orgs.length === 1
      ? orgs[0]
      : undefined;
  if (options.org && !chosen)
    throw new Error(`You aren't a member of ${options.org}.`);
  const file = options.save({
    api: options.api,
    token,
    email: session?.user?.email,
    org: chosen?.id,
  });

  const who = session?.user?.email ?? "you";
  if (chosen)
    return {
      code: 0,
      out: `Signed in as ${who} to ${chosen.name} (${chosen.id}). Saved to ${file}.`,
    };
  return {
    code: 0,
    out: [
      `Signed in as ${who}. Saved to ${file}.`,
      orgs.length
        ? "Choose an organization with --org or PREPROCESS_ORG:"
        : "You aren't in an organization yet. Create one in the app.",
      ...orgs.map((o) => `  ${o.id}  ${o.name}`),
    ].join("\n"),
  };
};
