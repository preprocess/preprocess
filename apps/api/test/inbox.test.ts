// The inbox, assignment and notification email (design doc 06): who sees
// what, who is emailed, the per-person switch, redelivery, and isolation
// between organizations.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { recordCaseEvent } from "../src/cases.ts";
import type { Env } from "../src/env.ts";
import { sendNotice } from "../src/notify.ts";
import type { OutboxMessage } from "../src/outbox.ts";
import {
  addMember,
  Client,
  createOrganization,
  sent,
  signUp,
  testEnv,
} from "./helpers.ts";

const emails: OutboxMessage[] = [];
const environment: Env = testEnv({
  EMAILS: {
    send: (message: OutboxMessage) => {
      emails.push(message);
      return Promise.resolve();
    },
  } as unknown as Queue<OutboxMessage>,
  WEBHOOKS: { send: () => Promise.resolve() } as unknown as Queue,
});

type Inbox = {
  items: {
    key: string;
    kind: string;
    read: boolean;
    case: { id: string; title: string | null };
    group: { slug: string } | null;
    message: string | null;
  }[];
  unread: number;
};

let owner: Client;
let org: string;
let lee: { client: Client; userId: string; email: string };
let quiet: { client: Client; userId: string; email: string };
let outsider: { client: Client; userId: string; email: string };
let keyed: Client;
const agentId = newId("agent");
const deploymentId = newId("deployment");
const legal = newId("group");

const newCase = async (title: string) => {
  const id = newId("case");
  await withOrg(environment, orgId(org), (tx) =>
    tx.insert(cases).values({
      id,
      organizationId: org,
      agentId,
      deploymentId,
      status: "running",
      source: "api",
      title,
    }),
  );
  return { organizationId: org, agentId, caseId: id };
};

const waitOn = (
  key: { organizationId: string; agentId: string; caseId: string },
  group: string | null,
  status: "waiting" | "completed" = "waiting",
) =>
  recordCaseEvent(environment, {
    ...key,
    type: "status",
    status,
    waitingOn: group,
    reason: group ? "Vendor not found in ERP" : null,
    answers: null,
    error: null,
  });

// Runs the EMAILS consumer over what was queued since the last call.
const deliver = async () => {
  const before = sent.length;
  for (const message of emails.splice(0))
    await sendNotice(environment, message);
  return sent.slice(before);
};

const inbox = async (client: Client) =>
  (await client.call<Inbox>(`/v1/orgs/${org}/inbox`)).body;

beforeAll(async () => {
  const ana = await signUp("Ana", environment);
  owner = ana.client;
  org = await createOrganization(owner, "Acme");
  lee = await addMember(owner, org, "Lee");
  quiet = await addMember(owner, org, "Quinn");
  outsider = await addMember(owner, org, "Otto");
  const key = await owner.call<{ key: string }>("/api/auth/api-key/create", {
    body: { name: "ci", organizationId: org },
  });
  keyed = new Client(environment, { "x-api-key": key.body.key });
  await withOrg(environment, orgId(org), async (tx) => {
    await tx
      .insert(agents)
      .values({ id: agentId, organizationId: org, slug: "invoices" });
    await tx.insert(deployments).values({
      id: deploymentId,
      organizationId: org,
      agentId,
      environment: "production",
      status: "ready",
      bundleSha256: "00",
      sdkVersion: "0.1.0",
      manifest: {},
      source: "cli",
      createdBy: ana.userId,
      promotedAt: new Date(),
    });
    await tx
      .insert(groups)
      .values({ id: legal, organizationId: org, slug: "legal", name: "Legal" });
    await tx.insert(groupMembers).values([
      { organizationId: org, groupId: legal, userId: lee.userId },
      { organizationId: org, groupId: legal, userId: quiet.userId },
    ]);
    await tx.insert(agentGrants).values({
      organizationId: org,
      agentId,
      groupId: legal,
      access: "operator",
      grantedBy: ana.userId,
    });
  });
  const off = await quiet.client.call("/api/auth/update-user", {
    body: { emailNotifications: false },
  });
  expect(off.status).toBe(200);
});

beforeEach(() => {
  emails.length = 0;
});

describe("the inbox", () => {
  it("lists a wait on the person's group once, and emails members who kept email on", async () => {
    const key = await newCase("Invoice 1042");
    await waitOn(key, "legal");
    await waitOn(key, "legal");
    const mail = await deliver();
    expect(mail.map((m) => m.to)).toEqual([lee.email]);
    expect(mail[0]!.subject).toBe(
      "Invoice 1042 (invoices) is waiting on Legal",
    );
    expect(mail[0]!.text).toContain("Reason: Vendor not found in ERP");
    expect(mail[0]!.text).toContain(`/cases/${agentId}/${key.caseId}`);

    for (const person of [lee, quiet]) {
      const items = (await inbox(person.client)).items.filter(
        (i) => i.case.id === key.caseId,
      );
      expect(items).toMatchObject([
        { kind: "waiting", read: false, group: { slug: "legal" } },
      ]);
    }
    expect(
      (await inbox(outsider.client)).items.some(
        (i) => i.case.id === key.caseId,
      ),
    ).toBe(false);

    await waitOn(key, null, "completed");
    expect(
      (await inbox(lee.client)).items.some((i) => i.case.id === key.caseId),
    ).toBe(false);
  });

  it("does not send twice when the queue redelivers", async () => {
    const key = await newCase("Invoice 1043");
    await waitOn(key, "legal");
    const [message] = emails;
    const first = await deliver();
    expect(first).toHaveLength(1);
    const before = sent.length;
    await sendNotice(environment, message!);
    expect(sent.length).toBe(before);
  });

  it("lists mentions of the person's groups, except their own, and emails the rest", async () => {
    const key = await newCase("Invoice 1044");
    await recordCaseEvent(environment, {
      ...key,
      type: "mention",
      group: "legal",
      messageId: "msg_1",
      by: `person:${lee.userId}`,
      message: "@legal can you check the payment terms?",
    });
    expect(await deliver()).toEqual([]);
    expect(
      (await inbox(lee.client)).items.some((i) => i.case.id === key.caseId),
    ).toBe(false);
    const quietItems = (await inbox(quiet.client)).items.filter(
      (i) => i.case.id === key.caseId,
    );
    expect(quietItems).toMatchObject([
      { kind: "mention", message: "@legal can you check the payment terms?" },
    ]);

    await recordCaseEvent(environment, {
      ...key,
      type: "mention",
      group: "legal",
      messageId: "msg_2",
      by: "agent",
      message: "The payment terms changed from net 30 to net 60.",
    });
    const mail = await deliver();
    expect(mail.map((m) => m.to)).toEqual([lee.email]);
    expect(mail[0]!.text).toContain("The invoices agent tagged Legal");
    expect(mail[0]!.text).not.toContain("Lee");
  });

  it("marks items read for that person only", async () => {
    const key = await newCase("Invoice 1045");
    await waitOn(key, "legal");
    const item = (await inbox(lee.client)).items.find(
      (i) => i.case.id === key.caseId,
    )!;
    const marked = await lee.client.call(`/v1/orgs/${org}/inbox/read`, {
      body: { keys: [item.key] },
    });
    expect(marked.status).toBe(204);
    expect(
      (await inbox(lee.client)).items.find((i) => i.key === item.key)?.read,
    ).toBe(true);
    expect(
      (await inbox(quiet.client)).items.find((i) => i.key === item.key)?.read,
    ).toBe(false);
  });

  it("belongs to people, not API keys", async () => {
    expect((await keyed.call(`/v1/orgs/${org}/inbox`)).status).toBe(403);
  });

  it("is not reachable from another organization", async () => {
    const other = await signUp("Eve", environment);
    await createOrganization(other.client, "Evil");
    expect((await other.client.call(`/v1/orgs/${org}/inbox`)).status).toBe(403);
  });
});

describe("assignment", () => {
  it("is for API keys, Owners and Admins, and only to people who can see the case", async () => {
    const key = await newCase("Invoice 2001");
    const path = `/v1/orgs/${org}/cases/${key.caseId}/assignees`;
    expect(
      (
        await lee.client.call(path, {
          method: "PUT",
          body: { userIds: [lee.userId] },
        })
      ).status,
    ).toBe(403);
    const refused = await keyed.call<{ error: { code: string } }>(path, {
      method: "PUT",
      body: { userIds: [outsider.userId] },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("assignee_without_access");

    const assigned = await keyed.call<{ assignees: { id: string }[] }>(path, {
      method: "PUT",
      body: { userIds: [lee.userId, quiet.userId] },
    });
    expect(assigned.status).toBe(200);
    const mail = await deliver();
    expect(mail.map((m) => m.to)).toEqual([lee.email]);
    expect(mail[0]!.subject).toBe(
      "Invoice 2001 (invoices) was assigned to you",
    );
    expect(
      (await inbox(lee.client)).items.filter((i) => i.case.id === key.caseId),
    ).toMatchObject([{ kind: "assigned" }]);

    // Replacing the set emails only people newly added.
    await owner.call(path, { method: "PUT", body: { userIds: [lee.userId] } });
    expect(await deliver()).toEqual([]);
    expect(
      (await inbox(quiet.client)).items.some((i) => i.case.id === key.caseId),
    ).toBe(false);

    const audit = await owner.call<{
      events: { data: { added: string[]; removed: string[] } }[];
    }>(`/v1/orgs/${org}/audit-events?action=case.assignees.updated`);
    expect(audit.body.events.map((e) => e.data)).toEqual(
      expect.arrayContaining([
        { added: [lee.userId, quiet.userId], removed: [] },
        { added: [], removed: [quiet.userId] },
      ]),
    );
  });
});
