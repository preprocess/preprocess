// The case list (spec: Cases, a list across agents with filters): only the
// agents a caller may see, filters, counts and cursor paging.

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
import { beforeAll, describe, expect, it } from "vitest";

import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";

type Summary = {
  id: string;
  agent: { slug: string };
  status: string;
  waitingOn: { slug: string } | null;
  deployment: { environment: string; branch: string | null };
};
type List = {
  items: Summary[];
  nextCursor: string | null;
  counts: Record<string, number>;
};

let org: string;
let owner: Client;
let operator: Client;
let outsider: Client;
let key: Client;
const invoices = newId("agent");
const payroll = newId("agent");
const finance = newId("group");
const ids = { invoices: [] as string[], payroll: [] as string[] };
let previewCase: string;

const list = (who: Client, query = "") =>
  who.call<List>(`/v1/orgs/${org}/cases${query}`);

beforeAll(async () => {
  const ana = await signUp("Ana");
  owner = ana.client;
  org = await createOrganization(owner, "Listco");
  const op = await addMember(owner, org, "Omar");
  operator = op.client;
  outsider = (await addMember(owner, org, "Mia")).client;
  const created = await owner.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "list", organizationId: org } },
  );
  key = new Client(testEnv(), { authorization: `Bearer ${created.body.key}` });
  await withOrg(testEnv(), orgId(org), async (tx) => {
    await tx.insert(agents).values([
      { id: invoices, organizationId: org, slug: "invoices" },
      { id: payroll, organizationId: org, slug: "payroll" },
    ]);
    const deployment = (
      agentId: string,
      environment: "production" | "preview",
    ) => ({
      id: newId("deployment"),
      organizationId: org,
      agentId,
      environment,
      status: "ready" as const,
      bundleSha256: "00",
      sdkVersion: "0.1.0",
      manifest: {},
      source: "cli" as const,
      createdBy: ana.userId,
      gitBranch: environment === "preview" ? "feature-x" : "main",
    });
    const prod = [
      deployment(invoices, "production"),
      deployment(payroll, "production"),
    ];
    const preview = deployment(invoices, "preview");
    await tx.insert(deployments).values([...prod, preview]);
    await tx.insert(groups).values({
      id: finance,
      organizationId: org,
      slug: "finance",
      name: "Finance",
    });
    await tx
      .insert(groupMembers)
      .values({ organizationId: org, groupId: finance, userId: op.userId });
    await tx.insert(agentGrants).values({
      organizationId: org,
      agentId: invoices,
      groupId: finance,
      access: "operator",
      grantedBy: ana.userId,
    });
    const at = (i: number) => new Date(Date.UTC(2026, 10, 20, 0, i));
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const id = newId("case");
      ids.invoices.push(id);
      rows.push({
        id,
        organizationId: org,
        agentId: invoices,
        deploymentId: prod[0]!.id,
        status: i < 2 ? ("waiting" as const) : ("completed" as const),
        waitingOnGroupId: i < 2 ? finance : null,
        source: "api" as const,
        title: `Invoice ${i}`,
        createdAt: at(i),
        updatedAt: at(i),
      });
    }
    for (let i = 0; i < 2; i++) {
      const id = newId("case");
      ids.payroll.push(id);
      rows.push({
        id,
        organizationId: org,
        agentId: payroll,
        deploymentId: prod[1]!.id,
        status: "running" as const,
        source: "api" as const,
        title: `Payroll ${i}`,
        createdAt: at(10 + i),
        updatedAt: at(10 + i),
      });
    }
    previewCase = newId("case");
    rows.push({
      id: previewCase,
      organizationId: org,
      agentId: invoices,
      deploymentId: preview.id,
      status: "completed" as const,
      source: "api" as const,
      title: "Preview",
      createdAt: at(20),
      updatedAt: at(20),
    });
    await tx.insert(cases).values(rows);
  });
});

describe("the case list", () => {
  it("shows only the agents the caller may see", async () => {
    const all = await list(owner);
    expect(all.status).toBe(200);
    expect(all.body.items.map((c) => c.id)).toEqual([
      ...[...ids.payroll].reverse(),
      ...[...ids.invoices].reverse(),
    ]);
    expect((await list(key)).body.items).toHaveLength(7);
    const mine = await list(operator);
    expect(mine.body.items.map((c) => c.agent.slug)).toEqual(
      Array(5).fill("invoices"),
    );
    expect(mine.body.counts).toMatchObject({
      waiting: 2,
      completed: 3,
      running: 0,
    });
    const none = await list(outsider);
    expect(none.body.items).toEqual([]);
    expect(none.body.counts.completed).toBe(0);
  });

  it("filters by agent, status, group and environment, and counts under the other filters", async () => {
    const waiting = await list(owner, "?status=waiting,running");
    expect(waiting.body.items).toHaveLength(4);
    expect(waiting.body.counts).toMatchObject({
      waiting: 2,
      running: 2,
      completed: 3,
    });
    const finance = await list(owner, "?waitingOn=finance");
    expect(finance.body.items.map((c) => c.waitingOn?.slug)).toEqual([
      "finance",
      "finance",
    ]);
    expect((await list(owner, "?agent=payroll")).body.items).toHaveLength(2);
    expect((await list(owner, "?q=Invoice%203")).body.items).toHaveLength(1);
    const previews = await list(owner, "?environment=preview");
    expect(previews.body.items.map((c) => [c.id, c.deployment.branch])).toEqual(
      [[previewCase, "feature-x"]],
    );
    expect((await list(owner, "?status=nope")).status).toBe(400);
  });

  it("pages with a cursor in either direction", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: List } = await list(
        owner,
        `?sort=createdAt&dir=asc&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      seen.push(...page.body.items.map((c) => c.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...ids.invoices, ...ids.payroll]);
    expect((await list(owner, "?cursor=garbage")).status).toBe(400);
  });
});
