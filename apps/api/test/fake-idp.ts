// An OpenID Connect and SAML identity provider and a DNS-over-HTTPS
// resolver, as the API Worker sees them in tests. Tests hand the provider the person it signs
// in next (POST /__next) and publish TXT records (POST /__dns); everything
// else is the protocol: discovery, keys, the token exchange and userinfo.

import { execFileSync } from "node:child_process";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import * as samlify from "samlify";

import { IDP, SAML_ENTITY, SAML_SSO_URL } from "./idp.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const kid = randomUUID();
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid,
  use: "sig",
  alg: "RS256",
};

type Person = {
  sub: string;
  email: string;
  given_name?: string;
  family_name?: string;
};
const codes = new Map<string, { person: Person; clientId: string }>();
const accessTokens = new Map<string, Person>();
let next: Person | undefined;
const txt = new Map<string, string[]>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const b64 = (value: string | Uint8Array) =>
  btoa(
    String.fromCharCode(
      ...(typeof value === "string" ? new TextEncoder().encode(value) : value),
    ),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const idToken = (person: Person, clientId: string) => {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = b64(
    JSON.stringify({
      iss: IDP,
      aud: clientId,
      iat: now,
      exp: now + 300,
      email_verified: true,
      ...person,
    }),
  );
  const signature = createSign("RSA-SHA256")
    .update(`${head}.${body}`)
    .sign(privateKey);
  return `${head}.${body}.${b64(signature)}`;
};

// The SAML side signs with a throwaway certificate made for this test run.
const dir = mkdtempSync(path.join(tmpdir(), "idp-"));
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=idp.test",
    "-keyout",
    path.join(dir, "key.pem"),
    "-out",
    path.join(dir, "cert.pem"),
  ],
  { stdio: "ignore" },
);
const samlCert = readFileSync(path.join(dir, "cert.pem"), "utf8");
const samlKey = readFileSync(path.join(dir, "key.pem"), "utf8");
const POST = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";
const samlIdp = samlify.IdentityProvider({
  entityID: SAML_ENTITY,
  signingCert: samlCert,
  privateKey: samlKey,
  isAssertionEncrypted: false,
  singleSignOnService: [
    {
      Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
      Location: SAML_SSO_URL,
    },
  ],
});

// The redirect binding's AuthnRequest: who asked, where to answer, and its id.
const samlResponse = async (url: URL) => {
  const xml = inflateRawSync(
    Uint8Array.from(atob(url.searchParams.get("SAMLRequest") ?? ""), (ch) =>
      ch.charCodeAt(0),
    ),
  ).toString("utf8");
  const id = /\sID="([^"]+)"/.exec(xml)?.[1] ?? "";
  const acs = /AssertionConsumerServiceURL="([^"]+)"/.exec(xml)?.[1] ?? "";
  const issuer = /<saml:Issuer[^>]*>([^<]+)</.exec(xml)?.[1] ?? "";
  const sp = samlify.ServiceProvider({
    entityID: issuer.replaceAll("&amp;", "&"),
    wantAssertionsSigned: true,
    wantMessageSigned: true,
    assertionConsumerService: [{ Binding: POST, Location: acs }],
  });
  const person = next!;
  const response = await samlIdp.createLoginResponse(
    sp,
    { extract: { request: { id } } },
    "post",
    { email: person.email },
  );
  return {
    acs,
    SAMLResponse: response.context,
    RelayState: url.searchParams.get("RelayState") ?? "",
  };
};

// Hosts DNS-over-HTTPS lookups go to.
const DOH = new Set([
  "cloudflare-dns.com",
  "1.1.1.1",
  "one.one.one.one",
  "dns.google",
]);
export const isFakeIdp = (url: URL) =>
  url.origin === IDP || DOH.has(url.hostname);

export const fakeIdp = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (DOH.has(url.hostname)) {
    const name = (url.searchParams.get("name") ?? "").replace(/\.$/, "");
    const records = txt.get(name.toLowerCase()) ?? [];
    return json(
      {
        Status: records.length ? 0 : 3,
        Question: [{ name: `${name}.`, type: 16 }],
        Answer: records.map((data) => ({
          name: `${name}.`,
          type: 16,
          TTL: 60,
          data: JSON.stringify(data),
        })),
      },
      200,
    );
  }
  const route = `${request.method} ${url.pathname}`;
  if (route === "POST /__next") {
    next = await request.json<Person>();
    return json({ ok: true });
  }
  if (route === "POST /__dns") {
    const { name, value } = await request.json<{
      name: string;
      value: string;
    }>();
    txt.set(name.toLowerCase(), [value]);
    return json({ ok: true });
  }
  if (route === "GET /.well-known/openid-configuration")
    return json({
      issuer: IDP,
      authorization_endpoint: `${IDP}/authorize`,
      token_endpoint: `${IDP}/token`,
      userinfo_endpoint: `${IDP}/userinfo`,
      jwks_uri: `${IDP}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
      ],
      scopes_supported: ["openid", "email", "profile"],
    });
  if (route === "GET /jwks") return json({ keys: [jwk] });
  // A real IdP answers with a page that posts this form to the ACS; tests post
  // it themselves.
  if (route === "GET /saml/cert") return new Response(samlCert);
  if (route === "GET /saml/sso") {
    if (!next) return json({ error: "nobody to sign in" }, 400);
    return json(await samlResponse(url));
  }
  if (route === "GET /authorize") {
    if (!next) return json({ error: "nobody to sign in" }, 400);
    const code = randomUUID();
    codes.set(code, {
      person: next,
      clientId: url.searchParams.get("client_id") ?? "",
    });
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", code);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    return Response.redirect(back.toString(), 302);
  }
  if (route === "POST /token") {
    const form = new URLSearchParams(await request.text());
    const found = codes.get(form.get("code") ?? "");
    if (!found) return json({ error: "invalid_grant" }, 400);
    codes.delete(form.get("code")!);
    const accessToken = `at_${randomUUID()}`;
    accessTokens.set(accessToken, found.person);
    return json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 300,
      id_token: idToken(found.person, found.clientId),
    });
  }
  if (route === "GET /userinfo") {
    const person = accessTokens.get(
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
    );
    return person
      ? json({ email_verified: true, ...person })
      : json({ error: "invalid_token" }, 401);
  }
  return json({ error: "not found" }, 404);
};
