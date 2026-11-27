// The GitHub App's side of GitHub (docs/design/08-github-app.md): webhook
// signatures, the App's JWT, installation tokens scoped to one repository,
// the source archive of a commit, and the installing person's OAuth check.
// Tokens are only ever held in memory here; they never reach Postgres, a
// log line or the build sandbox.

import { HTTPException } from "hono/http-exception";

import type { Env } from "./env.ts";

const encoder = new TextEncoder();

const api = (env: Env) => env.GITHUB_API_URL ?? "https://api.github.com";
const web = (env: Env) => env.GITHUB_URL ?? "https://github.com";

export const githubConfigured = (env: Env) =>
  Boolean(
    env.GITHUB_APP_ID &&
    env.GITHUB_APP_SLUG &&
    env.GITHUB_APP_PRIVATE_KEY &&
    env.GITHUB_WEBHOOK_SECRET &&
    env.GITHUB_CLIENT_ID &&
    env.GITHUB_CLIENT_SECRET,
  );

const requireConfigured = (env: Env) => {
  if (!githubConfigured(env))
    throw new HTTPException(503, {
      message: "The GitHub App is not configured on this install.",
    });
};

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (text: string) => {
  if (!/^(?:[0-9a-f]{2})+$/.test(text)) return null;
  return Uint8Array.from(text.match(/../g)!, (b) => parseInt(b, 16));
};

const base64url = (bytes: Uint8Array | string) =>
  btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const hmacKey = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );

// X-Hub-Signature-256: sha256=<hex HMAC of the raw body>. subtle.verify
// compares in constant time.
export const verifyWebhook = async (
  env: Env,
  body: string,
  header: string | undefined,
) => {
  requireConfigured(env);
  const signature = fromHex(header?.replace(/^sha256=/, "") ?? "");
  if (!signature) return false;
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(env.GITHUB_WEBHOOK_SECRET!, "verify"),
    signature,
    encoder.encode(body),
  );
};

// The install link's state: the organization and person who asked, for ten
// minutes, signed with a key derived from the auth secret.
const stateKey = (env: Env) => `github-install:${env.BETTER_AUTH_SECRET}`;

export const signState = async (
  env: Env,
  state: { org: string; user: string },
) => {
  const payload = base64url(
    JSON.stringify({ ...state, exp: Date.now() + 10 * 60_000 }),
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(stateKey(env), "sign"),
    encoder.encode(payload),
  );
  return `${payload}.${hex(mac)}`;
};

export const readState = async (env: Env, value: string) => {
  const [payload, mac] = value.split(".");
  const signature = fromHex(mac ?? "");
  if (
    !payload ||
    !signature ||
    !(await crypto.subtle.verify(
      "HMAC",
      await hmacKey(stateKey(env), "verify"),
      signature,
      encoder.encode(payload),
    ))
  )
    return null;
  const state = JSON.parse(
    atob(payload.replaceAll("-", "+").replaceAll("_", "/")),
  ) as { org: string; user: string; exp: number };
  return state.exp > Date.now() ? state : null;
};

export const installUrl = async (
  env: Env,
  state: { org: string; user: string },
) => {
  requireConfigured(env);
  const url = new URL(
    `/apps/${env.GITHUB_APP_SLUG}/installations/new`,
    web(env),
  );
  url.searchParams.set("state", await signState(env, state));
  return url.href;
};

// Where the installing account changes the App's repositories or uninstalls
// it on GitHub.
export const installationSettingsUrl = (
  env: Env,
  installation: {
    installationId: number;
    accountLogin: string;
    accountType: string;
  },
) =>
  new URL(
    installation.accountType === "Organization"
      ? `/organizations/${installation.accountLogin}/settings/installations/${installation.installationId}`
      : `/settings/installations/${installation.installationId}`,
    web(env),
  ).href;

// RS256 JWT for the App itself, valid ten minutes (GitHub's maximum), from
// the PKCS #8 PEM private key.
const appJwt = async (env: Env) => {
  const pem = env.GITHUB_APP_PRIVATE_KEY!.replace(
    /-----(BEGIN|END) PRIVATE KEY-----|\s/g,
    "",
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }),
  )}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(unsigned),
  );
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
};

export class GitHubError extends Error {}

const call = async <T>(
  env: Env,
  path: string,
  init: { method?: string; auth: string; body?: unknown },
): Promise<T> => {
  const method = init.method ?? "GET";
  const response = await fetch(new URL(path, api(env)), {
    method,
    headers: {
      authorization: init.auth,
      accept: "application/vnd.github+json",
      "user-agent": "preprocess",
      "x-github-api-version": "2022-11-28",
      ...(init.body !== undefined && { "content-type": "application/json" }),
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
  if (!response.ok)
    throw new GitHubError(
      `GitHub ${method} ${path} answered ${response.status}`,
    );
  return (response.status === 204 ? undefined : await response.json()) as T;
};

export type Installation = {
  id: number;
  account: { login: string; type: string };
};

export const getInstallation = async (env: Env, installationId: number) =>
  call<Installation>(env, `/app/installations/${installationId}`, {
    auth: `Bearer ${await appJwt(env)}`,
  });

export type Repository = {
  id: number;
  full_name: string;
  default_branch?: string;
  private: boolean;
};

// An installation token limited to the given repositories and to read
// access. Callers revoke it as soon as they are done; GitHub expires it
// within the hour regardless.
const installationToken = async (
  env: Env,
  installationId: number,
  scope: { repositoryIds?: number[]; permissions: Record<string, "read"> },
) =>
  (
    await call<{ token: string }>(
      env,
      `/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        auth: `Bearer ${await appJwt(env)}`,
        body: {
          ...(scope.repositoryIds && { repository_ids: scope.repositoryIds }),
          permissions: scope.permissions,
        },
      },
    )
  ).token;

const revoke = (env: Env, token: string) =>
  call(env, "/installation/token", {
    method: "DELETE",
    auth: `Bearer ${token}`,
  }).catch((error: unknown) =>
    console.error(
      JSON.stringify({
        job: "github",
        error: `revoke failed: ${String(error)}`,
      }),
    ),
  );

// Runs `work` with a token for one repository's contents, then revokes it.
export const withRepositoryToken = async <T>(
  env: Env,
  installationId: number,
  repositoryId: number,
  work: (token: string) => Promise<T>,
) => {
  const token = await installationToken(env, installationId, {
    repositoryIds: [repositoryId],
    permissions: { contents: "read" },
  });
  try {
    return await work(token);
  } finally {
    await revoke(env, token);
  }
};

export const listRepositories = async (env: Env, installationId: number) => {
  const token = await installationToken(env, installationId, {
    permissions: { metadata: "read" },
  });
  try {
    const repositories: Repository[] = [];
    for (let page = 1; ; page++) {
      const { repositories: batch } = await call<{
        repositories: Repository[];
      }>(env, `/installation/repositories?per_page=100&page=${page}`, {
        auth: `Bearer ${token}`,
      });
      repositories.push(...batch);
      if (batch.length < 100) return repositories;
    }
  } finally {
    await revoke(env, token);
  }
};

// The gzipped tarball of one commit. GitHub redirects to a short-lived
// codeload URL; the token stays in this Worker.
export const commitArchive = async (
  env: Env,
  token: string,
  fullName: string,
  commit: string,
) => {
  const response = await fetch(
    new URL(`/repos/${fullName}/tarball/${commit}`, api(env)),
    {
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": "preprocess",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!response.ok || !response.body)
    throw new GitHubError(
      `GitHub could not provide ${fullName}@${commit} (${response.status})`,
    );
  return response.body as ReadableStream<Uint8Array>;
};

// The installing person authorizes the App during installation, so the
// setup callback carries a code. Their token proves they can reach the
// installation they are linking; it is used once and dropped.
export const personCanReach = async (
  env: Env,
  code: string,
  installationId: number,
) => {
  const response = await fetch(new URL("/login/oauth/access_token", web(env)), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const { access_token: token } = await response.json<{
    access_token?: string;
  }>();
  if (!token) return false;
  for (let page = 1; ; page++) {
    const { installations } = await call<{ installations: { id: number }[] }>(
      env,
      `/user/installations?per_page=100&page=${page}`,
      { auth: `Bearer ${token}` },
    );
    if (installations.some((i) => i.id === installationId)) return true;
    if (installations.length < 100) return false;
  }
};
