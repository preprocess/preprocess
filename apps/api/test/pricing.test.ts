// Pricing end to end (spec 16a): what a piece of work costs at our prices,
// in micro-USD, and what reaches Autumn for it: whole credits of $0.01 and
// whole GB-months, with what is left under one carried into the next report.
// Nothing is ever rounded up. Autumn's API is stubbed; nothing here leaves the
// test. Other test files report usage too, and any run may carry this
// organization's usage, so these read what was reported rather than who sent
// it.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { usageRecords, usageReports } from "@preprocess/db/schema/billing";
import { asc } from "drizzle-orm";
import {
  decideCostMicroUsd,
  MARKUP,
  microUsd,
  ocrCostMicroUsd,
} from "@preprocess/models/prices";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { reportDaily, reportUsage } from "../src/billing.ts";
import type { Env } from "../src/env.ts";
import { sandboxPrice } from "../src/sandbox.ts";
import { createOrganization, signUp, testEnv } from "./helpers.ts";

let org: string;

const environment: Env = testEnv({ AUTUMN_SECRET_KEY: "am_sk_test_stub" });

const stubAutumn = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.useautumn.com")
      throw new Error(`unexpected fetch to ${url.hostname}`);
    const body = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    ) as Record<string, unknown>;
    const customer = url.pathname.endsWith("customers.get_or_create")
      ? { id: body.customer_id, subscriptions: [], flags: {}, balances: {} }
      : {};
    return Promise.resolve(
      new Response(JSON.stringify(customer), {
        headers: { "content-type": "application/json" },
      }),
    );
  });

const record = (
  feature: "model_usage" | "decide" | "ocr" | "sandbox" | "log_bytes",
  quantity: number,
) =>
  withOrg(environment, orgId(org), (tx) =>
    tx.insert(usageRecords).values({
      id: newId("usageRecord"),
      organizationId: org,
      feature,
      quantity,
    }),
  );

// Per billed feature: whole units sent so far, and what the last report
// carried on. Every report must have reached Autumn.
const billed = async () => {
  const reports = await withOrg(environment, orgId(org), (tx) =>
    tx.select().from(usageReports).orderBy(asc(usageReports.seq)),
  );
  expect(reports.every((r) => r.reportedAt)).toBe(true);
  const totals: Record<string, { units: number; carried: number }> = {};
  for (const r of reports)
    totals[r.feature] = {
      units: (totals[r.feature]?.units ?? 0) + r.quantity,
      carried: r.remainder,
    };
  return totals;
};

beforeAll(async () => {
  const owner = await signUp("Pricer", environment);
  org = await createOrganization(owner.client, "Priceco");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pricing", () => {
  it("prices work in micro-USD at our rates", () => {
    // DeepSeek V4.1 Flash, $0.30 in and $1.20 out per million tokens plus 5%
    // (apps/runtime/src/models.ts): 1M input and 200k output tokens.
    expect(microUsd(((1_000_000 * 0.3 + 200_000 * 1.2) / 1e6) * MARKUP)).toBe(
      567_000,
    );
    // decide: 500k input tokens at $0.035 per million plus 5%.
    expect(decideCostMicroUsd(500_000)).toBe(18_375);
    // OCR: 50 pages at $4 per 1,000 plus 5%.
    expect(ocrCostMicroUsd(50)).toBe(210_000);
    // A small case sandbox awake for an hour.
    expect(sandboxPrice("small", 3_600)).toBe(111_024);
  });

  it("sends whole credits and carries the rest into the next report", async () => {
    stubAutumn();
    await record("model_usage", 567_000);
    await record("decide", 18_375);
    await record("ocr", 210_000);
    await record("sandbox", 111_024);
    await reportUsage(environment);
    // $0.906399 of work: 89 credits ($0.89) now, never 91.
    const first = {
      model_usage_credits: { units: 56, carried: 7_000 },
      decide_credits: { units: 1, carried: 8_375 },
      ocr_credits: { units: 21, carried: 0 },
      sandbox_credits: { units: 11, carried: 1_024 },
    };
    expect(await billed()).toEqual(first);

    await reportUsage(environment);
    expect(await billed()).toEqual(first);

    // The carried 7,000 and 8,375 micro-USD make whole credits with more use;
    // the sandbox's 1,524 wait for more.
    await record("model_usage", 3_000);
    await record("decide", 1_625);
    await record("sandbox", 500);
    await reportUsage(environment);
    expect(await billed()).toEqual({
      ...first,
      model_usage_credits: { units: 57, carried: 0 },
      decide_credits: { units: 2, carried: 0 },
      sandbox_credits: { units: 11, carried: 1_524 },
    });

    await record("sandbox", 8_476);
    await reportUsage(environment);
    expect((await billed()).sandbox_credits).toEqual({ units: 12, carried: 0 });
  });

  it("sends whole GB-months of storage, a day's share at a time", async () => {
    stubAutumn();
    // 45 GB stored through November: 1.5 GB-months a day.
    await record("log_bytes", 45e9);
    await reportDaily(environment, new Date("2026-11-02T00:05:00Z"));
    expect((await billed()).storage_gb_months).toEqual({
      units: 1,
      carried: 500_000,
    });

    await reportDaily(environment, new Date("2026-11-02T00:06:00Z"));
    expect((await billed()).storage_gb_months).toEqual({
      units: 1,
      carried: 500_000,
    });

    await reportDaily(environment, new Date("2026-11-03T00:05:00Z"));
    expect((await billed()).storage_gb_months).toEqual({
      units: 3,
      carried: 0,
    });
    const ids = await withOrg(environment, orgId(org), (tx) =>
      tx.select({ id: usageReports.id }).from(usageReports),
    );
    expect(ids.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        `storage:${org}:2026-11-01`,
        `storage:${org}:2026-11-02`,
      ]),
    );
  });
});
