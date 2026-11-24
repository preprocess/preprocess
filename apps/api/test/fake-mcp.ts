// A remote MCP server behind OAuth (authorization code with PKCE and dynamic
// client registration), as the API Worker sees it on the internet in tests.
// It runs in Node as the test Worker's outbound service.

import { createHash, randomUUID } from "node:crypto";

const ORIGIN = "https://crm.test";

type Code = { challenge: string; redirectUri: string; clientId: string };

const codes = new Map<string, Code>();
const access = new Set<string>();
const refresh = new Set<string>();
export const seen: { authorization: string[] } = { authorization: [] };

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });

const issue = () => {
  const accessToken = `at-${randomUUID()}`;
  const refreshToken = `rt-${randomUUID()}`;
  access.add(accessToken);
  refresh.add(refreshToken);
  return json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: 3600,
  });
};

const rpc = async (request: Request) => {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !access.has(token))
    return new Response("unauthorized", {
      status: 401,
      headers: {
        "www-authenticate": `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
      },
    });
  seen.authorization.push(token);
  const body = await request.json<{
    id?: number;
    method: string;
    params?: { name?: string; arguments?: { q?: string } };
  }>();
  if (body.id === undefined) return new Response(null, { status: 202 });
  if (body.method === "initialize")
    return json(
      {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "crm", version: "1" },
        },
      },
      { headers: { "mcp-session-id": "session-1" } },
    );
  if (body.method === "tools/list")
    return json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        tools: [
          {
            name: "search_contacts",
            description: "Search CRM contacts",
            inputSchema: {
              type: "object",
              properties: { q: { type: "string" } },
            },
          },
        ],
      },
    });
  // Tool calls answer as an event stream, as streamable HTTP servers may.
  const result = {
    jsonrpc: "2.0",
    id: body.id,
    result: {
      content: [
        {
          type: "text",
          text: `Ada Lovelace, buyer (${body.params?.arguments?.q})`,
        },
      ],
    },
  };
  return new Response(`event: message\ndata: ${JSON.stringify(result)}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
};

export const fakeMcp = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.origin !== ORIGIN)
    return new Response("no such host", { status: 502 });
  switch (url.pathname) {
    case "/.well-known/oauth-protected-resource":
      return json({
        resource: `${ORIGIN}/mcp`,
        authorization_servers: [ORIGIN],
        scopes_supported: ["contacts"],
      });
    case "/.well-known/oauth-authorization-server":
      return json({
        issuer: ORIGIN,
        authorization_endpoint: `${ORIGIN}/authorize`,
        token_endpoint: `${ORIGIN}/token`,
        registration_endpoint: `${ORIGIN}/register`,
        code_challenge_methods_supported: ["S256"],
      });
    case "/register":
      return json({ client_id: `client-${randomUUID()}` }, { status: 201 });
    // The person approves at once.
    case "/authorize": {
      const code = randomUUID();
      codes.set(code, {
        challenge: url.searchParams.get("code_challenge")!,
        redirectUri: url.searchParams.get("redirect_uri")!,
        clientId: url.searchParams.get("client_id")!,
      });
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state")!);
      return new Response(null, {
        status: 302,
        headers: { location: back.href },
      });
    }
    case "/token": {
      const form = new URLSearchParams(await request.text());
      if (form.get("grant_type") === "refresh_token") {
        if (!refresh.delete(form.get("refresh_token") ?? ""))
          return json({ error: "invalid_grant" }, { status: 400 });
        return issue();
      }
      const pending = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const challenge = createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest("base64url");
      if (
        !pending ||
        pending.challenge !== challenge ||
        pending.redirectUri !== form.get("redirect_uri") ||
        pending.clientId !== form.get("client_id")
      )
        return json({ error: "invalid_grant" }, { status: 400 });
      return issue();
    }
    // Test hook: every access token stops working, as when one expires early.
    case "/test/expire":
      access.clear();
      return new Response(null, { status: 204 });
    case "/mcp":
      return rpc(request);
    default:
      return new Response("not found", { status: 404 });
  }
};
