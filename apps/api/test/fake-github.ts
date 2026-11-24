// GitHub as the API Worker sees it in tests: the App's REST endpoints, the
// OAuth exchange and commit tarballs. It runs in Node as part of the test
// Worker's outbound service and records every token it issues, so tests can
// check a token's scope, its revocation, and that it went nowhere else.

import { randomUUID } from "node:crypto";

export const GITHUB_API = "https://api.github.test";
export const GITHUB_WEB = "https://github.test";
export const INSTALLATION = 4242;
export const REPOSITORY = {
  id: 77,
  full_name: "acme/agents",
  private: true,
  default_branch: "main",
};
const OTHER = {
  id: 78,
  full_name: "acme/website",
  private: false,
  default_branch: "main",
};

type Token = {
  value: string;
  repositoryIds?: number[];
  permissions: unknown;
  revoked: boolean;
  used: number;
};
const tokens: Token[] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const bearer = (request: Request) =>
  request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";

export const fakeGithub = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  if (route === "GET /__tokens") return json(tokens);
  if (url.origin === GITHUB_WEB && route === "POST /login/oauth/access_token") {
    const { code } = await request.json<{ code: string }>();
    return json(
      code === "good"
        ? { access_token: `gho_${randomUUID()}` }
        : { error: "bad_verification_code" },
    );
  }
  if (route === "GET /user/installations")
    return json({ installations: [{ id: INSTALLATION }] });
  // The App's JWT: three dot-separated parts, issued by App 1.
  const jwt = bearer(request).split(".");
  const appCall =
    jwt.length === 3 &&
    (
      JSON.parse(atob(jwt[1]!.replaceAll("-", "+").replaceAll("_", "/"))) as {
        iss?: string;
      }
    ).iss === "1";
  let match = /^POST \/app\/installations\/(\d+)\/access_tokens$/.exec(route);
  if (match) {
    if (!appCall || Number(match[1]) !== INSTALLATION)
      return json({ message: "Bad credentials" }, 401);
    const body = await request.json<{
      repository_ids?: number[];
      permissions: unknown;
    }>();
    const token: Token = {
      value: `ghs_${randomUUID().replaceAll("-", "")}`,
      ...(body.repository_ids && { repositoryIds: body.repository_ids }),
      permissions: body.permissions,
      revoked: false,
      used: 0,
    };
    tokens.push(token);
    return json({ token: token.value }, 201);
  }
  match = /^GET \/app\/installations\/(\d+)$/.exec(route);
  if (match)
    return appCall && Number(match[1]) === INSTALLATION
      ? json({
          id: INSTALLATION,
          account: { login: "acme", type: "Organization" },
        })
      : json({ message: "Not Found" }, 404);
  const token = tokens.find((t) => t.value === bearer(request) && !t.revoked);
  if (route === "DELETE /installation/token") {
    if (token) token.revoked = true;
    return new Response(null, { status: 204 });
  }
  if (route === "GET /installation/repositories")
    return token ? json({ repositories: [REPOSITORY, OTHER] }) : json({}, 401);
  // A tarball whose content is the commit, which the fake builder reads.
  match = /^GET \/repos\/acme\/agents\/tarball\/(\w+)$/.exec(route);
  if (match) {
    if (
      !token ||
      (token.repositoryIds && !token.repositoryIds.includes(REPOSITORY.id))
    )
      return json({ message: "Not Found" }, 404);
    token.used++;
    return new Response(match[1]);
  }
  return json({ message: `fake GitHub has no ${route}` }, 404);
};
