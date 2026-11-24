// Drives the API Worker the way the app does: Better Auth on /api/auth/*,
// the product API on /v1/*, one cookie jar per person.

import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";

import worker from "../src/index.ts";
import type { Env } from "../src/env.ts";

export const sent: { to: string; subject: string; text: string }[] = [];

// Email goes to this list instead of the local runtime's file sink.
// Our cloud by default, where sign-up is open; self-hosted tests unset the region.
export const testEnv = (overrides: Partial<Env> = {}): Env => ({
  ...env,
  PREPROCESS_REGION: "us",
  EMAIL: {
    send: vi.fn((message: { to: string; subject: string; text: string }) => {
      sent.push(message);
      return Promise.resolve({ messageId: `test-${sent.length}` });
    }),
  } as unknown as SendEmail,
  ...overrides,
});

export type Response<T = unknown> = {
  status: number;
  body: T;
  headers: Headers;
};

export class Client {
  cookie = "";
  constructor(
    readonly environment: Env = testEnv(),
    readonly headers: Record<string, string> = {},
  ) {}

  async call<T = unknown>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response<T>> {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request(new URL(path, this.environment.APP_URL), {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: {
          origin: this.environment.APP_URL,
          "content-type": "application/json",
          ...(this.cookie ? { cookie: this.cookie } : {}),
          ...this.headers,
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
      this.environment,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const setCookie = response.headers.getSetCookie();
    if (setCookie.length)
      this.cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON
    }
    return {
      status: response.status,
      body: body as T,
      headers: response.headers,
    };
  }
}

let counter = 0;
export const unique = (name: string) =>
  `${name}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

// Opens the link in the newest email to `email` (verification), as the person would.
export const followEmailLink = async (client: Client, email: string) => {
  const mail = [...sent].reverse().find((m) => m.to === email);
  const link = mail?.text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error(`no email with a link for ${email}`);
  const url = new URL(link);
  return client.call(url.pathname + url.search);
};

export const signUp = async (
  name: string,
  environment = testEnv(),
  email = `${unique(name.toLowerCase())}@example.test`,
) => {
  const client = new Client(environment);
  const result = await client.call<{ user: { id: string } }>(
    "/api/auth/sign-up/email",
    { body: { name, email, password: "correct horse battery" } },
  );
  if (result.status !== 200)
    throw new Error(
      `sign-up failed: ${result.status} ${JSON.stringify(result.body)}`,
    );
  await followEmailLink(client, email);
  return { client, email, userId: result.body.user.id };
};

export const createOrganization = async (client: Client, name: string) => {
  const result = await client.call<{ id: string }>(
    "/api/auth/organization/create",
    { body: { name, slug: unique(name.toLowerCase()) } },
  );
  if (result.status !== 200)
    throw new Error(
      `create org failed: ${result.status} ${JSON.stringify(result.body)}`,
    );
  return result.body.id;
};

// Owner invites, the invitee signs up with that email and accepts.
export const addMember = async (
  owner: Client,
  org: string,
  name: string,
  role: "member" | "admin" = "member",
) => {
  const email = `${unique(name.toLowerCase())}@example.test`;
  const invited = await owner.call<{ id: string }>(
    "/api/auth/organization/invite-member",
    { body: { email, role, organizationId: org } },
  );
  if (invited.status !== 200)
    throw new Error(
      `invite failed: ${invited.status} ${JSON.stringify(invited.body)}`,
    );
  const { client, userId } = await signUp(name, owner.environment, email);
  const accepted = await client.call(
    "/api/auth/organization/accept-invitation",
    {
      body: { invitationId: invited.body.id },
    },
  );
  if (accepted.status !== 200)
    throw new Error(
      `accept failed: ${accepted.status} ${JSON.stringify(accepted.body)}`,
    );
  return { client, email, userId, invitationId: invited.body.id };
};
