// Datasets (design doc 10): saved queries over an agent's closed cases, who
// may read and who may write them, what each query selects, the sft,
// preference and replay exports built from a fixture capture, their audit
// events, and another organization reaching none of it.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import { cases, caseSearch, reviewEvents } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { beforeAll, describe, expect, it } from "vitest";

import type { Env, RunCapture, Runtime } from "../src/env.ts";
import { fixtureCapture } from "./fixtures/capture.ts";
import {
  addMember,
  callStream,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";

type Key = { organizationId: string; agentId: string; caseId: string };

const stored = new Map<string, RunCapture>();
const read: Key[] = [];
const runtime = {
  readCapture: (k: Key) => {
    read.push(k);
    return Promise.resolve(
      stored.get(`${k.organizationId}/${k.agentId}/${k.caseId}`) ?? null,
    );
  },
} as unknown as Runtime;
const environment: Env = testEnv({ RUNTIME: runtime });

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

type Dataset = {
  id: string;
  agentId: string;
  name: string;
  query: Record<string, unknown>;
  count: number;
  updatedBy: { id: string; name: string | null };
  error?: { code: string };
};
type Preview = {
  count: number;
  cases: { id: string; status: string; editedFields: string[] }[];
};
type Message = {
  role: string;
  content: unknown;
  toolName?: string;
};
type Line = Record<string, unknown> & {
  case?: { id: string };
  messages?: Message[];
  prompt?: Message[];
  chosen?: Message[];
  rejected?: Message[];
};

const lines = (body: string) =>
  body
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Line);

// The value schema_answer sent for a path, in the first call of these messages.
const answered = (messages: Message[], path: string) => {
  for (const m of messages)
    if (m.role === "assistant" && Array.isArray(m.content))
      for (const block of m.content as {
        type: string;
        name?: string;
        arguments?: { answers?: { path: string; value: unknown }[] };
      }[])
        if (block.type === "toolCall" && block.name === "schema_answer")
          return block.arguments?.answers?.find((a) => a.path === path)?.value;
  return undefined;
};
const resultAfter = (messages: Message[], path: string) => {
  const result = messages.find(
    (m) => m.role === "toolResult" && m.toolName === "schema_answer",
  );
  const text = (result?.content as { text: string }[] | undefined)?.[0]?.text;
  return (JSON.parse(text ?? "[]") as { path: string; after?: unknown }[]).find(
    (r) => r.path === path,
  )?.after;
};

type Seeded = {
  org: string;
  agentId: string;
  deployA: string;
  deployB: string;
  corrected: string;
  accepted: string;
  failed: string;
  cancelled: string;
  running: string;
};

const seed = async (org: string, userId: string): Promise<Seeded> => {
  const agentId = newId("agent");
  const s: Seeded = {
    org,
    agentId,
    deployA: newId("deployment"),
    deployB: newId("deployment"),
    corrected: newId("case"),
    accepted: newId("case"),
    failed: newId("case"),
    cancelled: newId("case"),
    running: newId("case"),
  };
  const base = { organizationId: org, agentId, source: "api" as const };
  await withOrg(environment, orgId(org), async (tx) => {
    await tx
      .insert(agents)
      .values({ id: agentId, organizationId: org, slug: "invoices" });
    for (const id of [s.deployA, s.deployB])
      await tx.insert(deployments).values({
        id,
        organizationId: org,
        agentId,
        environment: "production",
        status: "ready",
        bundleSha256: "00",
        sdkVersion: "0.1.0",
        manifest: {},
        source: "cli",
        createdBy: userId,
        promotedAt: new Date(),
      });
    await tx.insert(cases).values([
      {
        ...base,
        id: s.corrected,
        deploymentId: s.deployA,
        status: "completed",
        title: "Globex invoice",
        createdAt: ago(5),
        completedAt: ago(5),
      },
      {
        ...base,
        id: s.accepted,
        deploymentId: s.deployA,
        status: "completed",
        createdAt: ago(4),
        completedAt: ago(4),
      },
      {
        ...base,
        id: s.failed,
        deploymentId: s.deployB,
        status: "failed",
        createdAt: ago(3),
        completedAt: ago(3),
      },
      {
        ...base,
        id: s.cancelled,
        deploymentId: s.deployB,
        status: "cancelled",
        createdAt: ago(2),
        updatedAt: ago(2),
      },
      {
        ...base,
        id: s.running,
        deploymentId: s.deployA,
        status: "running",
        createdAt: ago(1),
      },
    ]);
    await tx.insert(caseSearch).values({
      organizationId: org,
      caseId: s.corrected,
      agentId,
      environment: "production",
      input: "Invoice from Globex",
      inputHash: "00",
      answers: { vendor: "Globex", total: 120 },
      changed: ["total"],
      completedAt: ago(5),
    });
    await tx.insert(reviewEvents).values([
      {
        id: newId("reviewEvent"),
        organizationId: org,
        caseId: s.corrected,
        userId,
        kind: "field.edited",
        path: "total",
        before: 12,
        after: 120,
        at: ago(4.9),
      },
      {
        id: newId("reviewEvent"),
        organizationId: org,
        caseId: s.accepted,
        userId,
        kind: "field.confirmed",
        path: "total",
        at: ago(3.9),
      },
    ]);
  });
  for (const [caseId, deploymentId] of [
    [s.corrected, s.deployA],
    [s.accepted, s.deployA],
    [s.failed, s.deployB],
  ] as const)
    stored.set(
      `${org}/${agentId}/${caseId}`,
      fixtureCapture({ organizationId: org, agentId, deploymentId, caseId }),
    );
  return s;
};

let owner: Client;
let ownerId: string;
let devId: string;
let developer: Client;
let viewer: Client;
let outsider: Client;
let keyed: Client;
let otherOwner: Client;
let a: Seeded;
let b: Seeded;

beforeAll(async () => {
  const ana = await signUp("Dana Owner", environment);
  owner = ana.client;
  ownerId = ana.userId;
  const org = await createOrganization(owner, "Datasetco");
  const dev = await addMember(owner, org, "Devi Developer");
  developer = dev.client;
  devId = dev.userId;
  const vic = await addMember(owner, org, "Val Viewer");
  viewer = vic.client;
  outsider = (await addMember(owner, org, "Ozzy Outsider")).client;
  const key = await owner.call<{ key: string }>("/api/auth/api-key/create", {
    body: { name: "ci", organizationId: org },
  });
  keyed = new Client(environment, { "x-api-key": key.body.key });
  const other = await signUp("Olive Other", environment);
  otherOwner = other.client;
  const otherOrg = await createOrganization(otherOwner, "Elsewhere");

  a = await seed(org, ana.userId);
  b = await seed(otherOrg, other.userId);

  const all = await owner.call<{ id: string; isDevelopers: boolean }[]>(
    `/v1/orgs/${org}/groups`,
  );
  await owner.call(
    `/v1/orgs/${org}/groups/${all.body.find((g) => g.isDevelopers)!.id}/members/${dev.userId}`,
    { method: "PUT" },
  );
  const watchers = newId("group");
  await withOrg(environment, orgId(org), async (tx) => {
    await tx.insert(groups).values({
      id: watchers,
      organizationId: org,
      slug: "watchers",
      name: "Watchers",
    });
    await tx
      .insert(groupMembers)
      .values({ organizationId: org, groupId: watchers, userId: vic.userId });
    await tx.insert(agentGrants).values({
      organizationId: org,
      agentId: a.agentId,
      groupId: watchers,
      access: "viewer",
      grantedBy: ana.userId,
    });
  });
});

const base = (s: Seeded) => `/v1/orgs/${s.org}/agents/invoices/datasets`;
const create = (client: Client, s: Seeded, name: string, query: unknown = {}) =>
  client.call<Dataset>(base(s), { body: { name, query } });
const preview = async (query: unknown) => {
  const made = await create(developer, a, `q-${crypto.randomUUID()}`, query);
  expect(made.status).toBe(201);
  const res = await viewer.call<Preview>(`${base(a)}/${made.body.id}/preview`);
  expect(res.status).toBe(200);
  return res.body;
};

describe("datasets", () => {
  it("are created, read, renamed and deleted, and audited", async () => {
    const made = await create(developer, a, "Corrected", {
      outcome: "corrected",
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      agentId: a.agentId,
      name: "Corrected",
      query: { outcome: "corrected" },
      count: 1,
      updatedBy: { id: devId, name: "Devi Developer" },
    });
    const taken = await create(keyed, a, "Corrected");
    expect(taken.status).toBe(409);
    expect(taken.body.error?.code).toBe("dataset_name_taken");

    const list = await viewer.call<{ items: Dataset[] }>(base(a));
    expect(list.body.items.map((d) => d.name)).toContain("Corrected");
    expect(
      (await viewer.call<Dataset>(`${base(a)}/${made.body.id}`)).body.name,
    ).toBe("Corrected");

    const renamed = await owner.call<Dataset>(`${base(a)}/${made.body.id}`, {
      method: "PATCH",
      body: {
        name: "Corrected cases",
        query: { outcome: "corrected", status: ["completed"] },
      },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({
      name: "Corrected cases",
      query: { status: ["completed"] },
      count: 1,
      updatedBy: { id: ownerId, name: "Dana Owner" },
    });
    const listed = await viewer.call<{ items: Dataset[] }>(base(a));
    expect(listed.body.items.find((d) => d.id === made.body.id)).toMatchObject({
      count: 1,
      updatedBy: { id: ownerId },
    });

    expect(
      (await keyed.call(`${base(a)}/${made.body.id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
    expect((await owner.call(`${base(a)}/${made.body.id}`)).status).toBe(404);

    const audit = await owner.call<{
      events: { action: string; targetId: string }[];
    }>(`/v1/orgs/${a.org}/audit-events?limit=500`);
    const actions = audit.body.events
      .filter((e) => e.targetId === made.body.id)
      .map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "dataset.created",
        "dataset.updated",
        "dataset.deleted",
      ]),
    );
  });

  it("are written only by Developers, Admins, Owners and API keys", async () => {
    expect((await create(viewer, a, "Nope")).status).toBe(403);
    expect((await create(outsider, a, "Nope")).status).toBe(403);
    const made = await create(owner, a, "Owned");
    expect(made.status).toBe(201);
    expect(
      (
        await viewer.call(`${base(a)}/${made.body.id}`, {
          method: "PATCH",
          body: { name: "Mine" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await viewer.call(`${base(a)}/${made.body.id}`, { method: "DELETE" }))
        .status,
    ).toBe(403);
  });

  it("are hidden from a member who cannot see the agent's cases", async () => {
    expect((await outsider.call(base(a))).status).toBe(404);
  });

  it("default to the last 30 days of completed cases, kept rolling", async () => {
    const made = await owner.call<Dataset>(base(a), {
      body: { name: "Default" },
    });
    expect(made.status).toBe(201);
    expect(made.body.query).toEqual({ period: "30d", status: ["completed"] });
    expect(made.body.count).toBe(2);
  });

  it("refuse a query outside the closed statuses or with two edit rules", async () => {
    expect(
      (
        await create(owner, a, "Bad", {
          period: "7d",
          from: ago(3).toISOString(),
        })
      ).status,
    ).toBe(400);
    expect((await create(owner, a, "Bad", { period: "1d" })).status).toBe(400);
    expect(
      (await create(owner, a, "Bad", { status: ["running"] })).status,
    ).toBe(400);
    expect(
      (await create(owner, a, "Bad", { edited: { any: true, none: true } }))
        .status,
    ).toBe(400);
    expect((await create(owner, a, "Bad", { since: "yesterday" })).status).toBe(
      400,
    );
  });
});

describe("a dataset's preview", () => {
  const ids = (p: Preview) => p.cases.map((c) => c.id).sort();

  it("holds only closed cases, newest first, with their edited fields", async () => {
    const all = await preview({});
    expect(all.count).toBe(4);
    expect(all.cases.map((c) => c.id)).toEqual([
      a.cancelled,
      a.failed,
      a.accepted,
      a.corrected,
    ]);
    expect(all.cases.find((c) => c.id === a.corrected)?.editedFields).toEqual([
      "total",
    ]);
    expect(all.cases.find((c) => c.id === a.accepted)?.editedFields).toEqual(
      [],
    );
  });

  it("selects by outcome, edits, deployment, status and time", async () => {
    expect(ids(await preview({ outcome: "corrected" }))).toEqual([a.corrected]);
    expect(ids(await preview({ outcome: "accepted" }))).toEqual([a.accepted]);
    expect(ids(await preview({ edited: { any: true } }))).toEqual([
      a.corrected,
    ]);
    expect(ids(await preview({ edited: { fields: ["total"] } }))).toEqual([
      a.corrected,
    ]);
    expect((await preview({ edited: { fields: ["vendor"] } })).count).toBe(0);
    expect(ids(await preview({ edited: { none: true } }))).toEqual(
      [a.accepted, a.failed, a.cancelled].sort(),
    );
    expect(ids(await preview({ deployments: [a.deployB] }))).toEqual(
      [a.failed, a.cancelled].sort(),
    );
    expect(ids(await preview({ status: ["completed"] }))).toEqual(
      [a.corrected, a.accepted].sort(),
    );
    expect(ids(await preview({ from: ago(3.5).toISOString() }))).toEqual(
      [a.failed, a.cancelled].sort(),
    );
    expect(ids(await preview({ to: ago(4.5).toISOString() }))).toEqual([
      a.corrected,
    ]);
    expect((await preview({ period: "7d" })).count).toBe(4);
    expect((await preview({ period: "all" })).count).toBe(4);
  });
});

describe("a draft query's preview", () => {
  let saved: string;
  beforeAll(async () => {
    saved = (await create(owner, a, "Saved everything")).body.id;
  });
  const draft = (client: Client, query: string, s = a, id = saved) =>
    client.call<Preview>(
      `${base(s)}/${id}/preview?query=${encodeURIComponent(query)}`,
    );

  it("previews the unsaved query in place of the saved one, for this call only", async () => {
    const res = await viewer.call<Preview>(
      `${base(a)}/${saved}/preview?query=${encodeURIComponent(JSON.stringify({ outcome: "corrected" }))}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.cases.map((c) => c.id)).toEqual([a.corrected]);
    expect(
      (
        await draft(
          viewer,
          JSON.stringify({ period: "30d", status: ["completed"] }),
        )
      ).body.count,
    ).toBe(2);
    expect(
      (await viewer.call<Preview>(`${base(a)}/${saved}/preview`)).body.count,
    ).toBe(4);
    expect(
      (await viewer.call<Dataset>(`${base(a)}/${saved}`)).body.query,
    ).toEqual({});
  });

  it("refuses a draft that is not a dataset query as JSON", async () => {
    for (const bad of [
      "{not json",
      JSON.stringify({ status: ["running"] }),
      JSON.stringify({ period: "7d", from: ago(3).toISOString() }),
      JSON.stringify({ since: "yesterday" }),
      JSON.stringify(["completed"]),
    ])
      expect((await draft(owner, bad)).status, bad).toBe(400);
  });

  it("keeps the preview's access rule", async () => {
    const query = JSON.stringify({ outcome: "corrected" });
    expect((await draft(outsider, query)).status).toBe(404);
    expect((await draft(otherOwner, query)).status).toBe(403);
    expect((await draft(otherOwner, query, b)).status).toBe(404);
    expect((await draft(keyed, query)).status).toBe(200);
  });
});

describe("the agent's answer fields", () => {
  it("are the answers' fields and every field a person edited, for anyone who can see the cases", async () => {
    const res = await viewer.call<{ fields: string[] }>(
      `/v1/orgs/${a.org}/agents/invoices/answer-fields`,
    );
    expect(res.status).toBe(200);
    expect(res.body.fields).toEqual(["total", "vendor"]);
    expect(
      (await outsider.call(`/v1/orgs/${a.org}/agents/invoices/answer-fields`))
        .status,
    ).toBe(404);
    expect(
      (
        await otherOwner.call(
          `/v1/orgs/${b.org}/agents/${a.agentId}/answer-fields`,
        )
      ).status,
    ).toBe(404);
  });
});

describe("a dataset's export", () => {
  let all: string;
  let corrected: string;
  beforeAll(async () => {
    all = (await create(owner, a, "Everything")).body.id;
    corrected = (await create(owner, a, "Fixed", { outcome: "corrected" })).body
      .id;
  });
  const exportPath = (id: string, query: string) =>
    `${base(a)}/${id}/export?${query}`;

  it("as sft is the conversation with the corrected answers", async () => {
    const res = await callStream(developer, exportPath(all, "format=sft"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const out = lines(res.body);
    const trailer = out.pop()!;
    expect(trailer).toEqual({ next: null, skipped: 1 });
    expect(out.map((l) => l.case!.id)).toEqual([
      a.corrected,
      a.accepted,
      a.failed,
    ]);
    const fixed = out[0]!.messages!;
    expect(fixed.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(answered(fixed, "total")).toBe(120);
    expect(answered(fixed, "vendor")).toBe("Globex");
    expect(resultAfter(fixed, "total")).toBe(120);
    const kept = out[1]!.messages!;
    expect(answered(kept, "total")).toBe(12);
    expect(resultAfter(kept, "total")).toBe(12);
  });

  it("as preference pairs the corrected and the agent's answers", async () => {
    const res = await callStream(keyed, exportPath(all, "format=preference"));
    const out = lines(res.body);
    expect(out.pop()).toEqual({ next: null, skipped: 0 });
    expect(out).toHaveLength(1);
    const pair = out[0]!;
    expect(pair.case!.id).toBe(a.corrected);
    expect(pair.prompt!.map((m) => m.role)).toEqual(["system", "user"]);
    expect(answered(pair.chosen!, "total")).toBe(120);
    expect(answered(pair.rejected!, "total")).toBe(12);
    expect(pair.chosen!.length).toBe(pair.rejected!.length);
  });

  it("as replay is the capture export's line", async () => {
    const out = lines(
      (await callStream(owner, exportPath(corrected, "format=replay"))).body,
    );
    expect(out.pop()).toEqual({ next: null, skipped: 0 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      case: { id: a.corrected, status: "completed", model: "kimi-k3.1-pro" },
      capture: { caseId: a.corrected },
      reviewEvents: [{ kind: "field.edited", path: "total", after: 120 }],
    });
  });

  it("pages with a cursor", async () => {
    const first = lines(
      (await callStream(owner, exportPath(all, "format=replay&limit=2"))).body,
    );
    expect(first.slice(0, -1).map((l) => l.case!.id)).toEqual([
      a.corrected,
      a.accepted,
    ]);
    const next = first.at(-1)!.next as string;
    const second = lines(
      (
        await callStream(
          owner,
          exportPath(
            all,
            `format=replay&limit=2&cursor=${encodeURIComponent(next)}`,
          ),
        )
      ).body,
    );
    expect(second.slice(0, -1).map((l) => l.case!.id)).toEqual([
      a.failed,
      a.cancelled,
    ]);
    expect(second.at(-1)?.next).toBeNull();
  });

  it("is for Developers, Admins, Owners and API keys, and audited", async () => {
    expect(
      (await callStream(viewer, exportPath(all, "format=sft"))).status,
    ).toBe(403);
    expect(
      (await callStream(outsider, exportPath(all, "format=sft"))).status,
    ).toBe(403);
    expect(
      (await callStream(owner, exportPath(all, "format=csv"))).status,
    ).toBe(400);
    const audit = await owner.call<{
      events: {
        targetId: string;
        data: { format: string; count: number };
      }[];
    }>(`/v1/orgs/${a.org}/audit-events?action=dataset.exported`);
    const formats = audit.body.events
      .filter((e) => e.targetId === all)
      .map((e) => [e.data.format, e.data.count]);
    expect(formats).toEqual(
      expect.arrayContaining([
        ["sft", 4],
        ["preference", 1],
      ]),
    );
  });
});

describe("another organization", () => {
  it("cannot read, export or register a dataset on this organization's agent", async () => {
    const made = await create(owner, a, "Private");
    expect((await otherOwner.call(base(a))).status).toBe(403);
    expect((await create(otherOwner, a, "Mine")).status).toBe(403);
    expect(
      (
        await callStream(
          otherOwner,
          `${base(a)}/${made.body.id}/export?format=sft`,
        )
      ).status,
    ).toBe(403);
    // Through its own organization's path, this organization's ids are not
    // found.
    const theirs = `/v1/orgs/${b.org}/agents`;
    expect(
      (await otherOwner.call(`${theirs}/${a.agentId}/datasets`)).status,
    ).toBe(404);
    expect(
      (
        await otherOwner.call(`${theirs}/${a.agentId}/datasets`, {
          body: { name: "Mine", query: {} },
        })
      ).status,
    ).toBe(404);
    expect((await otherOwner.call(`${base(b)}/${made.body.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await callStream(
          otherOwner,
          `${base(b)}/${made.body.id}/export?format=replay`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await otherOwner.call(`${base(b)}/${made.body.id}/preview`)).status,
    ).toBe(404);
    // Its own export reads only its own captures.
    const own = await create(otherOwner, b, "Theirs");
    await callStream(
      otherOwner,
      `${base(b)}/${own.body.id}/export?format=replay`,
    );
    expect(
      read
        .filter((k) => k.organizationId === b.org)
        .every((k) => k.agentId === b.agentId),
    ).toBe(true);
    expect(
      read.some((k) => k.organizationId === b.org && k.caseId === a.corrected),
    ).toBe(false);
  });
});
