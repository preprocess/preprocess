// Drives the API Worker the way the app does: Better Auth on /api/auth/*,
// the product API on /v1/*, one cookie jar per person.

import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import type { LogRecord } from "@preprocess/logs";
import { env } from "cloudflare:workers";
import { vi } from "vitest";

import worker from "../src/index.ts";
import type { Env } from "../src/env.ts";
import type { OtelRetry } from "../src/otel.ts";

export const sent: {
  to: string;
  subject: string;
  text: string;
  html: string;
}[] = [];

// Run-log records the API queued (design doc 09), instead of the local queue.
export const logged: LogRecord[] = [];
// Records an OpenTelemetry export put back on the queue for another attempt.
export const retried: { body: OtelRetry; delaySeconds: number | undefined }[] =
  [];

// Email goes to this list instead of the local runtime's file sink.
// Our cloud by default, where sign-up is open; self-hosted tests unset the region.
export const testEnv = (overrides: Partial<Env> = {}): Env => ({
  ...env,
  PREPROCESS_REGION: "us",
  EMAIL: {
    send: vi.fn((message: (typeof sent)[number]) => {
      sent.push(message);
      return Promise.resolve({ messageId: `test-${sent.length}` });
    }),
  } as unknown as SendEmail,
  LOGS: {
    sendBatch: (
      messages: { body: LogRecord | OtelRetry; delaySeconds?: number }[],
    ) => {
      for (const m of messages)
        if ("otelRetry" in m.body)
          retried.push({ body: m.body, delaySeconds: m.delaySeconds });
        else logged.push(m.body);
      return Promise.resolve();
    },
  } as unknown as Queue<LogRecord | OtelRetry>,
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
    // `form` posts the body as an HTML form would, as an identity provider's
    // SAML response arrives.
    init: {
      method?: string;
      body?: unknown;
      form?: Record<string, string>;
    } = {},
  ): Promise<Response<T>> {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request(new URL(path, this.environment.APP_URL), {
        method:
          init.method ??
          (init.body === undefined && !init.form ? "GET" : "POST"),
        headers: {
          origin: this.environment.APP_URL,
          "content-type": init.form
            ? "application/x-www-form-urlencoded"
            : "application/json",
          ...(this.cookie ? { cookie: this.cookie } : {}),
          ...this.headers,
        },
        ...(init.form
          ? { body: new URLSearchParams(init.form).toString() }
          : init.body === undefined
            ? {}
            : { body: JSON.stringify(init.body) }),
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

// A streamed body (an NDJSON or CSV export) is written while the request's
// context is still open, so it is read before waiting on that context.
export const callStream = async (client: Client, path: string) => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(new URL(path, client.environment.APP_URL), {
      headers: {
        origin: client.environment.APP_URL,
        ...(client.cookie ? { cookie: client.cookie } : {}),
        ...client.headers,
      },
    }),
    client.environment,
    ctx,
  );
  const body = await response.text();
  await waitOnExecutionContext(ctx);
  return { status: response.status, headers: response.headers, body };
};

// Test files run in parallel isolates, each with its own counter, so the
// random part keeps two files' names apart.
let counter = 0;
export const unique = (name: string) =>
  `${name}-${Date.now().toString(36)}-${(counter++).toString(36)}${crypto.randomUUID().slice(0, 6)}`;

// Opens the link in the newest email to `email` (a sign-in link or an
// invitation), as the person would.
export const followEmailLink = async (client: Client, email: string) => {
  const mail = [...sent].reverse().find((m) => m.to === email);
  const link = mail?.text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error(`no email with a link for ${email}`);
  const url = new URL(link);
  return client.call(url.pathname + url.search);
};

// Asks for a sign-in link and opens it. There are no passwords.
export const signInByLink = async (client: Client, email: string) => {
  const asked = await client.call("/api/auth/sign-in/magic-link", {
    body: { email, callbackURL: "/" },
  });
  if (asked.status !== 200) return asked;
  return followEmailLink(client, email);
};

// A new person signs in by link and enters their first and last name, as the
// app asks right after. "Ada" becomes Ada Tester; "Ada Lovelace" stays.
export const signUp = async (
  name: string,
  environment = testEnv(),
  email = `${unique(name.toLowerCase().replaceAll(" ", "-"))}@example.test`,
) => {
  const client = new Client(environment);
  const asked = await signInByLink(client, email);
  if (asked.status >= 400)
    throw new Error(
      `sign-in link failed: ${asked.status} ${JSON.stringify(asked.body)}`,
    );
  const [firstName, ...rest] = name.split(" ");
  const named = await client.call("/api/auth/update-user", {
    body: { firstName, lastName: rest.join(" ") || "Tester" },
  });
  if (named.status !== 200)
    throw new Error(
      `naming failed: ${named.status} ${JSON.stringify(named.body)}`,
    );
  const session = await client.call<{ user: { id: string } } | null>(
    "/api/auth/get-session",
  );
  if (!session.body) throw new Error(`no session for ${email}`);
  return { client, email, userId: session.body.user.id };
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
  const email = `${unique(name.toLowerCase().replaceAll(" ", "-"))}@example.test`;
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
