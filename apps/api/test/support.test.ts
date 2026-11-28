// Support requests (PRE-155): tenant isolation (another organization can't
// list, read, reply to, solve, attach to or download a request; Members see
// their own, Owners and Admins all), the signed-out form's Turnstile check,
// the 25 MB attachment cap, our replies and their notices, the audit of
// support reads in the customer's organization only, retention, deleting an
// organization, email threading, and self-hosted installs answering 404.

import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { auditEvents } from "@preprocess/db/schema/audit";
import {
  supportAttachments,
  supportMessages,
  supportRequests,
} from "@preprocess/db/schema/support";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { Env } from "../src/env.ts";
import worker from "../src/index.ts";
import {
  addBusinessHours,
  auditSupportContextRead,
  firstResponseDue,
  postSupportReply,
  sweepSupportRetention,
} from "../src/support.ts";
import { receiveSupportEmail, stripQuoted } from "../src/support-inbound.ts";
import {
  addMember,
  Client,
  createOrganization,
  sent,
  signUp,
  testEnv,
  tracked,
  unique,
} from "./helpers.ts";

const environment = testEnv({
  POSTHOG_KEY: "phc_test",
  SUPPORT_EMAIL_FROM: "Preprocess Support <support@preprocess.test>",
  SUPPORT_INBOUND_DOMAIN: "support.preprocess.test",
});

type Request = {
  id: string;
  status: string;
  channel: string;
  requester: { userId: string | null; email: string };
  firstResponseAt: string | null;
};
type Detail = Request & {
  messages: { authorKind: string; authorName: string; body: string }[];
  attachments: { id: string; filename: string; size: number }[];
};
type Attachment = { id: string; size: number };

const upload = async (
  client: Client,
  path: string,
  bytes: Uint8Array,
  name = "notes.txt",
) => {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: "text/plain" }));
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new globalThis.Request(new URL(path, client.environment.APP_URL), {
      method: "POST",
      headers: {
        origin: client.environment.APP_URL,
        ...(client.cookie ? { cookie: client.cookie } : {}),
        ...client.headers,
      },
      body: form,
    }),
    client.environment,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return {
    status: response.status,
    body: await response.json<
      Attachment & { error?: { code: string; message: string } }
    >(),
  };
};

const ask = (
  client: Client,
  org: string,
  extra: Record<string, unknown> = {},
) =>
  client.call<Request>(`/v1/orgs/${org}/support/requests`, {
    body: {
      subject: "Deploys are slow",
      body: "Every deploy takes ten minutes.",
      category: "agents",
      severity: 2,
      ...extra,
    },
  });

let owner: Client;
let ownerEmail: string;
let org: string;
let admin: Client;
let member: Client;
let memberId: string;
let memberEmail: string;
let otherOwner: Client;
let otherOrg: string;
let keyed: Client;

beforeAll(async () => {
  const ana = await signUp("Ana", environment);
  owner = ana.client;
  ownerEmail = ana.email;
  org = await createOrganization(owner, "Acme");
  admin = (await addMember(owner, org, "Ada", "admin")).client;
  const plain = await addMember(owner, org, "Mo");
  member = plain.client;
  memberId = plain.userId;
  memberEmail = plain.email;
  otherOwner = (await signUp("Olu", environment)).client;
  otherOrg = await createOrganization(otherOwner, "Other");
  const key = await owner.call<{ key: string }>("/api/auth/api-key/create", {
    body: { name: "support", organizationId: org },
  });
  keyed = new Client(environment, { authorization: `Bearer ${key.body.key}` });
});

describe("support requests in an organization", () => {
  it("records a request with the requester's email and acknowledges it", async () => {
    const created = await ask(member, org);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: "open",
      channel: "form",
      requester: { userId: memberId, email: memberEmail },
    });
    const ack = [...sent].reverse().find((m) => m.to === memberEmail) as
      ((typeof sent)[number] & { from: string; replyTo?: string }) | undefined;
    expect(ack?.subject).toBe("We got your request: Deploys are slow");
    expect(ack?.from).toBe("Preprocess Support <support@preprocess.test>");
    expect(ack?.replyTo).toMatch(/^r\+[a-z2-7]{26}@support\.preprocess\.test$/);
  });

  it("tracks each new request with ids and enums only, on every channel", async () => {
    const start = tracked.length;
    const id = (await ask(member, org, { category: "getting-started" })).body
      .id;
    const email = await receiveSupportEmail(environment, {
      from: memberEmail,
      to: "requests@support.preprocess.test",
      raw: `From: ${memberEmail}\r\nTo: requests@support.preprocess.test\r\nSubject: Secret subject\r\nContent-Type: text/plain\r\n\r\nSecret body\r\n`,
    });
    const events = tracked
      .slice(start)
      .filter((e) => e.event === "support_request_created");
    expect(events.map((e) => e.properties.request_id)).toEqual([
      id,
      email.requestId,
    ]);
    expect(events[0]).toMatchObject({
      distinctId: memberId,
      properties: {
        organization_id: org,
        channel: "form",
        category: "getting_started",
        severity: 2,
        plan: "free",
      },
    });
    expect(events[1]?.properties).toMatchObject({
      channel: "email",
      category: "other",
    });
    const text = JSON.stringify(events);
    for (const secret of ["Deploys are slow", "Secret", memberEmail])
      expect(text).not.toContain(secret);
  });

  it("lets Members see only their own requests, and Owners and Admins all", async () => {
    const mine = (await ask(member, org)).body.id;
    const owners = (await ask(owner, org)).body.id;
    const list = async (client: Client) =>
      (
        await client.call<{ items: Request[] }>(
          `/v1/orgs/${org}/support/requests`,
        )
      ).body.items.map((r) => r.id);
    expect(await list(member)).toContain(mine);
    expect(await list(member)).not.toContain(owners);
    expect(await list(admin)).toEqual(expect.arrayContaining([mine, owners]));
    expect(await list(keyed)).toEqual(expect.arrayContaining([mine, owners]));
    expect(
      (await member.call(`/v1/orgs/${org}/support/requests/${owners}`)).status,
    ).toBe(404);
    expect(
      (await admin.call(`/v1/orgs/${org}/support/requests/${mine}`)).status,
    ).toBe(200);
  });

  it("keeps another organization out of every request and attachment", async () => {
    const id = (await ask(owner, org)).body.id;
    const file = await upload(
      owner,
      `/v1/orgs/${org}/support/requests/${id}/attachments`,
      new TextEncoder().encode("log line"),
    );
    expect(file.status).toBe(201);
    // Through its own organization's path: not visible.
    expect(
      (
        await otherOwner.call<{ items: Request[] }>(
          `/v1/orgs/${otherOrg}/support/requests`,
        )
      ).body.items.map((r) => r.id),
    ).not.toContain(id);
    for (const call of [
      () => otherOwner.call(`/v1/orgs/${otherOrg}/support/requests/${id}`),
      () =>
        otherOwner.call(
          `/v1/orgs/${otherOrg}/support/requests/${id}/messages`,
          {
            body: { body: "hello" },
          },
        ),
      () =>
        otherOwner.call(`/v1/orgs/${otherOrg}/support/requests/${id}/solve`, {
          method: "POST",
        }),
      () =>
        otherOwner.call(
          `/v1/orgs/${otherOrg}/support/attachments/${file.body.id}`,
        ),
    ])
      expect((await call()).status).toBe(404);
    expect(
      (
        await upload(
          otherOwner,
          `/v1/orgs/${otherOrg}/support/requests/${id}/attachments`,
          new Uint8Array([1]),
        )
      ).status,
    ).toBe(404);
    // Through this organization's path: not a member.
    expect(
      (await otherOwner.call(`/v1/orgs/${org}/support/requests/${id}`)).status,
    ).toBe(403);
    // An attachment uploaded in another organization can't be sent here.
    const foreign = await upload(
      otherOwner,
      `/v1/orgs/${otherOrg}/support/attachments`,
      new Uint8Array([1, 2]),
    );
    expect(
      (await ask(owner, org, { attachments: [foreign.body.id] })).status,
    ).toBe(404);
  });

  it("sends uploads with a request, downloads them for those who see it, and refuses over 25 MB", async () => {
    const early = await upload(
      member,
      `/v1/orgs/${org}/support/attachments`,
      new TextEncoder().encode("trace"),
      "trace.txt",
    );
    expect(early.status).toBe(201);
    // Only the uploader may send it.
    expect(
      (await ask(admin, org, { attachments: [early.body.id] })).status,
    ).toBe(404);
    const id = (await ask(member, org, { attachments: [early.body.id] })).body
      .id;
    const detail = await member.call<Detail>(
      `/v1/orgs/${org}/support/requests/${id}`,
    );
    expect(detail.body.attachments).toMatchObject([
      { id: early.body.id, filename: "trace.txt", size: 5 },
    ]);
    const download = await admin.call(
      `/v1/orgs/${org}/support/attachments/${early.body.id}`,
    );
    expect(download.status).toBe(200);
    expect(download.body).toBe("trace");
    const otherMember = (await addMember(owner, org, "Pat")).client;
    expect(
      (
        await otherMember.call(
          `/v1/orgs/${org}/support/attachments/${early.body.id}`,
        )
      ).status,
    ).toBe(404);
    const big = await upload(
      member,
      `/v1/orgs/${org}/support/requests/${id}/attachments`,
      new Uint8Array(26_214_401),
    );
    expect(big.status).toBe(413);
    expect(big.body.error?.message).toBe("Attachments are at most 25 MB.");
  });

  it("asks an API key for an email address and replays an Idempotency-Key", async () => {
    expect((await ask(keyed, org)).status).toBe(400);
    const key = unique("idem");
    const first = await keyed.call<Request>(
      `/v1/orgs/${org}/support/requests`,
      {
        body: {
          subject: "Hi",
          body: "There",
          category: "other",
          email: "ops@acme.test",
        },
      },
    );
    expect(first.body.channel).toBe("api");
    const again = () =>
      new Client(environment, {
        ...keyed.headers,
        "idempotency-key": key,
      }).call<Request>(`/v1/orgs/${org}/support/requests`, {
        body: {
          subject: "Hi",
          body: "There",
          category: "other",
          email: "ops@acme.test",
        },
      });
    const a = await again();
    const b = await again();
    expect(a.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
  });

  it("records a request when the support case can't be opened", async () => {
    const env = testEnv({
      SUPPORT_ORG_ID: otherOrg,
      SUPPORT_AGENT_ID: "missing",
    });
    const client = new Client(env);
    client.cookie = owner.cookie;
    const created = await ask(client, org);
    expect(created.status).toBe(201);
    const [row] = await withOrg(environment, orgId(org), (tx) =>
      tx
        .select()
        .from(supportRequests)
        .where(eq(supportRequests.id, created.body.id)),
    );
    expect(row?.supportCaseId).toBeNull();
  });

  it("threads our replies, counts the first response and leaves a notice until opened", async () => {
    const id = (await ask(member, org)).body.id;
    const fromAgent = await postSupportReply(environment, id, {
      authorKind: "agent",
      body: "Try a smaller bundle.",
    });
    expect(fromAgent.request).toMatchObject({
      status: "waiting_on_customer",
      firstResponseAt: null,
    });
    const reply = [...sent].reverse().find((m) => m.to === memberEmail);
    expect(reply?.subject).toBe("Re: Deploys are slow");
    expect(reply?.text).toContain("Try a smaller bundle.");
    const notices = await member.call<{ items: { requestId: string }[] }>(
      `/v1/orgs/${org}/support/notices`,
    );
    expect(notices.body.items.map((n) => n.requestId)).toContain(id);
    // The owner opening it leaves the member's notice.
    await owner.call(`/v1/orgs/${org}/support/requests/${id}`);
    const detail = await member.call<Detail>(
      `/v1/orgs/${org}/support/requests/${id}`,
    );
    expect(
      detail.body.messages.map((m) => [m.authorKind, m.authorName]),
    ).toEqual([
      ["customer", "Mo Tester"],
      ["agent", "Preprocess Support"],
    ]);
    expect(
      (
        await member.call<{ items: { requestId: string }[] }>(
          `/v1/orgs/${org}/support/notices`,
        )
      ).body.items.map((n) => n.requestId),
    ).not.toContain(id);
    await member.call(`/v1/orgs/${org}/support/requests/${id}/messages`, {
      body: { body: "Still slow." },
    });
    const solved = await postSupportReply(environment, id, {
      authorKind: "agent",
      body: "Fixed on our side.",
      solves: true,
    });
    expect(solved.request).toMatchObject({
      status: "solved",
      firstResponseSolved: true,
    });
    expect(solved.request.firstResponseAt).not.toBeNull();
    // Replying reopens it.
    await member.call(`/v1/orgs/${org}/support/requests/${id}/messages`, {
      body: { body: "It broke again." },
    });
    const reopened = await member.call<Request & { solvedAt: string | null }>(
      `/v1/orgs/${org}/support/requests/${id}`,
    );
    expect(reopened.body).toMatchObject({
      status: "waiting_on_us",
      solvedAt: null,
    });
  });

  it("audits a support read in the customer's organization and only there", async () => {
    const id = (await ask(member, org)).body.id;
    await auditSupportContextRead(environment, id, {
      by: "agent",
      what: ["plan", "usage"],
    });
    const rows = await withoutOrg(environment, "test: audit", (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.targetId, id)),
    );
    const reads = rows.filter((r) => r.action === "support.context_read");
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      organizationId: org,
      actorType: "agent",
      data: { what: ["plan", "usage"], targets: [] },
    });
  });
});

describe("signed-out requests", () => {
  const post = (body: Record<string, unknown>) =>
    new Client(environment).call<{ id: string; error?: { code: string } }>(
      "/api/support/requests",
      {
        body: {
          email: "visitor@example.test",
          subject: "Pricing question",
          body: "Do you have a nonprofit plan?",
          category: "billing-and-credits",
          ...body,
        },
      },
    );

  it("refuses a missing or failed Turnstile check and records a passing one", async () => {
    expect((await post({})).body.error?.code).toBe("turnstile_required");
    const failed = await post({ turnstileToken: "nope" });
    expect(failed.status).toBe(403);
    const passed = await post({ turnstileToken: "pass" });
    expect(passed.status).toBe(201);
    const [row] = await withoutOrg(environment, "test: support", (tx) =>
      tx
        .select()
        .from(supportRequests)
        .where(eq(supportRequests.id, passed.body.id)),
    );
    expect(row).toMatchObject({ organizationId: null, channel: "form" });
  });

  it("is not served on a self-hosted install", async () => {
    const selfHosted = testEnv({
      PREPROCESS_REGION: undefined,
    } as unknown as Partial<Env>);
    expect(
      (await new Client(selfHosted).call("/api/support/requests", { body: {} }))
        .status,
    ).toBe(404);
    const client = new Client(selfHosted);
    client.cookie = owner.cookie;
    expect((await client.call(`/v1/orgs/${org}/support/requests`)).status).toBe(
      404,
    );
  });
});

const mime = (
  headers: Record<string, string>,
  text: string,
  attachment?: string,
) => {
  const head = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
  if (!attachment)
    return `${head}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n`;
  return [
    head,
    'Content-Type: multipart/mixed; boundary="b1"',
    "",
    "--b1",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
    "--b1",
    'Content-Type: text/plain; name="log.txt"',
    'Content-Disposition: attachment; filename="log.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    btoa(attachment),
    "--b1--",
    "",
  ].join("\r\n");
};

describe("support email", () => {
  it("strips quoted history from a reply", () => {
    expect(
      stripQuoted(
        "Thanks, that worked.\n\nOn Mon, Nov 30, 2026 at 9:00 AM Preprocess Support <\nsupport@preprocess.com> wrote:\n> Try this",
      ),
    ).toBe("Thanks, that worked.");
    expect(stripQuoted("Yes\n-----Original Message-----\nFrom: x")).toBe("Yes");
  });

  it("files a new email in the sender's organization and threads the reply", async () => {
    const created = await receiveSupportEmail(environment, {
      from: memberEmail,
      to: "requests@support.preprocess.test",
      raw: mime(
        {
          From: `Mo <${memberEmail}>`,
          To: "requests@support.preprocess.test",
          Subject: "Webhook errors",
        },
        "Our webhooks fail with 500.",
      ),
    });
    expect(created).toMatchObject({ result: "created" });
    const [row] = await withOrg(environment, orgId(org), (tx) =>
      tx
        .select()
        .from(supportRequests)
        .where(eq(supportRequests.id, created.requestId!)),
    );
    expect(row).toMatchObject({
      organizationId: org,
      requesterUserId: memberId,
      channel: "email",
      subject: "Webhook errors",
    });
    const threaded = await receiveSupportEmail(environment, {
      from: memberEmail,
      to: `r+${row!.replyToken}@support.preprocess.test`,
      raw: mime(
        {
          From: memberEmail,
          To: `r+${row!.replyToken}@support.preprocess.test`,
          Subject: "Re: Webhook errors",
        },
        "Here is the log.\n\nOn Tue, Dec 1, 2026, Preprocess Support wrote:\n> What do the logs say?",
        "500 Internal Server Error",
      ),
    });
    expect(threaded).toMatchObject({
      result: "threaded",
      requestId: row!.id,
      attachments: 1,
    });
    const detail = await member.call<Detail>(
      `/v1/orgs/${org}/support/requests/${row!.id}`,
    );
    expect(detail.body.status).toBe("waiting_on_us");
    expect(detail.body.messages.at(-1)?.body).toBe("Here is the log.");
    expect(detail.body.attachments.map((a) => a.filename)).toEqual(["log.txt"]);
  });

  it("keeps an unknown sender's email out of every organization", async () => {
    const stranger = `${unique("stranger")}@example.test`;
    const result = await receiveSupportEmail(environment, {
      from: stranger,
      to: "requests@support.preprocess.test",
      raw: mime(
        {
          From: stranger,
          To: "requests@support.preprocess.test",
          Subject: "Hello",
        },
        "Who are you?",
      ),
    });
    const [row] = await withoutOrg(environment, "test: support", (tx) =>
      tx
        .select()
        .from(supportRequests)
        .where(eq(supportRequests.id, result.requestId!)),
    );
    expect(row).toMatchObject({
      organizationId: null,
      requesterEmail: stranger,
    });
    // A stranger writing to someone else's reply address starts their own.
    const [known] = await withOrg(environment, orgId(org), (tx) =>
      tx
        .select()
        .from(supportRequests)
        .where(eq(supportRequests.requesterUserId, memberId)),
    );
    const hijack = await receiveSupportEmail(environment, {
      from: stranger,
      to: `r+${known!.replyToken}@support.preprocess.test`,
      raw: mime(
        {
          From: stranger,
          To: `r+${known!.replyToken}@support.preprocess.test`,
          Subject: "Re",
        },
        "Let me in",
      ),
    });
    expect(hijack.result).toBe("created");
    expect(hijack.requestId).not.toBe(known!.id);
  });
});

describe("support retention and deletion", () => {
  it("deletes solved requests after 2 years and attachments after 1, with their objects", async () => {
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const ids = {
      old: newId("supportRequest"),
      recent: newId("supportRequest"),
    };
    const files = {
      old: newId("supportAttachment"),
      fresh: newId("supportAttachment"),
    };
    const key = (request: string, file: string) =>
      `support/${org}/${request}/${file}`;
    await withOrg(environment, orgId(org), async (tx) => {
      for (const [id, solvedAt] of [
        [ids.old, ago(731)],
        [ids.recent, ago(700)],
      ] as const)
        await tx.insert(supportRequests).values({
          id,
          organizationId: org,
          requesterEmail: ownerEmail,
          subject: "Old",
          category: "other",
          severity: 3,
          status: "solved",
          channel: "form",
          replyToken: unique("token"),
          solvedAt,
        });
      for (const [id, createdAt] of [
        [files.old, ago(366)],
        [files.fresh, ago(10)],
      ] as const)
        await tx.insert(supportAttachments).values({
          id,
          requestId: ids.recent,
          organizationId: org,
          r2Key: key(ids.recent, id),
          filename: "a.txt",
          contentType: "text/plain",
          sizeBytes: 1,
          createdAt,
        });
    });
    for (const file of Object.values(files))
      await environment.FILES.put(key(ids.recent, file), "x");
    await sweepSupportRetention(environment, now);
    const left = await withOrg(environment, orgId(org), async (tx) => ({
      requests: (
        await tx
          .select({ id: supportRequests.id })
          .from(supportRequests)
          .where(inArray(supportRequests.id, [ids.old, ids.recent]))
      ).map((r) => r.id),
      files: (
        await tx
          .select({ id: supportAttachments.id })
          .from(supportAttachments)
          .where(inArray(supportAttachments.id, Object.values(files)))
      ).map((r) => r.id),
    }));
    expect(left).toEqual({ requests: [ids.recent], files: [files.fresh] });
    expect(await environment.FILES.get(key(ids.recent, files.old))).toBeNull();
    expect(
      await environment.FILES.get(key(ids.recent, files.fresh)),
    ).not.toBeNull();
    const [purged] = await withOrg(environment, orgId(org), (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "support.retention.purged")),
    );
    expect(purged?.data).toMatchObject({
      counts: { requests: 1, attachments: 1 },
    });
  });

  it("deletes an organization's requests, messages, attachments and objects with it", async () => {
    const { client } = await signUp("Del", environment);
    const doomed = await createOrganization(client, "Doomed");
    const id = (await ask(client, doomed)).body.id;
    const file = await upload(
      client,
      `/v1/orgs/${doomed}/support/requests/${id}/attachments`,
      new Uint8Array([7]),
    );
    const deleted = await client.call("/api/auth/organization/delete", {
      body: { organizationId: doomed },
    });
    expect(deleted.status).toBe(200);
    const left = await withoutOrg(environment, "test: support", async (tx) => [
      ...(await tx
        .select()
        .from(supportRequests)
        .where(eq(supportRequests.organizationId, doomed))),
      ...(await tx
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.organizationId, doomed))),
      ...(await tx
        .select()
        .from(supportAttachments)
        .where(eq(supportAttachments.organizationId, doomed))),
    ]);
    expect(left).toEqual([]);
    expect(
      await environment.FILES.get(`support/${doomed}/${id}/${file.body.id}`),
    ).toBeNull();
  });
});

describe("first response targets", () => {
  // Wednesday 2026-12-02, 16:00 Pacific (PST, UTC-8).
  const wednesday4pm = new Date("2026-12-03T00:00:00Z");
  it("counts business hours in Pacific time", () => {
    expect(addBusinessHours(wednesday4pm, 2).toISOString()).toBe(
      "2026-12-03T18:00:00.000Z",
    );
    // Friday 16:00 plus 8 business hours: 1 on Friday, 7 from Monday 9:00.
    expect(
      addBusinessHours(new Date("2026-12-05T00:00:00Z"), 8).toISOString(),
    ).toBe("2026-12-08T00:00:00.000Z");
  });
  it("follows the SLA table", () => {
    expect(firstResponseDue("free", 1, wednesday4pm)).toBeNull();
    expect(firstResponseDue("enterprise", 1, wednesday4pm)?.toISOString()).toBe(
      "2026-12-03T01:00:00.000Z",
    );
    expect(firstResponseDue("team", 3, wednesday4pm)?.toISOString()).toBe(
      addBusinessHours(wednesday4pm, 16).toISOString(),
    );
  });
});
