// Our cloud's plans as code (spec 16a, PRE-39). Nobody edits plans in
// Autumn's dashboard or over MCP: change this file in a pull request. CI
// previews it against the sandbox on every pull request, the staging deploy
// applies it to the sandbox, and the production deploy applies it to the live
// environment and stops for an explicit go if existing customers' plans
// would change. A self-hosted install never reads it.
//
// Units the app tracks: model_usage, decide and ocr in micro-USD already
// priced at our cost plus 5% (packages/models/src/prices.ts and
// apps/runtime/src/models.ts); storage in thousandths of a GB-month, tracked
// daily; seats as active seat-months, tracked when a month closes.
// Credit systems count cents: one credit is $0.01.

import { atmn, feature, plan } from "atmn";

// The one-time model credit a Free organization gets (Chip, 2026-11-26:
// "One time $5"), in dollars.
const FREE_MODEL_CREDIT_USD = 5;

// Training is priced at 2.5 times what its provider charges us. Training is
// Coming soon and its provider is undecided (spec 12a), so nothing bills it.
export const TRAINING_MULTIPLIER = 2.5;

const CENTS = 100;
const MICRO_USD_PER_CENT = 10_000;

export const seats = feature({
  featureId: "seats",
  name: "Active seats",
  type: "metered",
  consumable: true,
});

export const cases = feature({
  featureId: "cases",
  name: "Cases",
  type: "metered",
  consumable: true,
});

export const modelUsage = feature({
  featureId: "model_usage",
  name: "Model tokens",
  type: "metered",
  consumable: true,
});

export const decide = feature({
  featureId: "decide",
  name: "decide",
  type: "metered",
  consumable: true,
});

export const ocr = feature({
  featureId: "ocr",
  name: "OCR",
  type: "metered",
  consumable: true,
});

export const storage = feature({
  featureId: "storage",
  name: "Storage",
  type: "metered",
  consumable: true,
});

// Free's one-time model credit: tokens, decide and OCR draw on it.
export const modelCredit = feature({
  featureId: "model_credit",
  name: "Model credit",
  type: "credit_system",
  creditSchema: [modelUsage, decide, ocr].map((f) => ({
    meteredFeatureId: f.featureId,
    creditCost: 1 / MICRO_USD_PER_CENT,
  })),
});

// Enterprise's annual commit, which seats and all usage draw down at the
// same rates Team pays.
export const commit = feature({
  featureId: "commit",
  name: "Committed spend",
  type: "credit_system",
  creditSchema: [
    { meteredFeatureId: seats.featureId, creditCost: 16 * CENTS },
    {
      meteredFeatureId: cases.featureId,
      tierBehavior: "graduated",
      tiers: [
        { to: 1_000, creditCost: 0 },
        { to: 10_000, creditCost: 2 },
        { to: 100_000, creditCost: 1 },
        { to: "inf", creditCost: 0.5 },
      ],
    },
    ...[modelUsage, decide, ocr].map((f) => ({
      meteredFeatureId: f.featureId,
      creditCost: 1 / MICRO_USD_PER_CENT,
    })),
    {
      meteredFeatureId: storage.featureId,
      tierBehavior: "graduated",
      tiers: [
        { to: 50_000, creditCost: 0 },
        { to: "inf", creditCost: 0.01 },
      ],
    },
  ],
});

// Paid features (apps/api/src/plan.ts) and training.
const flag = (featureId: string, name: string) =>
  feature({ featureId, name, type: "boolean" });
export const sso = flag("sso", "SSO");
export const scim = flag("scim", "Directory sync");
export const syncedGroups = flag("synced_groups", "Synced groups");
export const customRoles = flag("custom_roles", "Custom roles");
export const auditExport = flag("audit_export", "Audit log export");
export const training = flag("training", "Training");
export const fineTuneServing = flag("fine_tune_serving", "Fine-tune serving");

const usagePrice = {
  billingMethod: "usage_based",
  interval: "month",
} as const;

// A card is required: Free is attached through checkout, never automatically,
// except to organizations that existed before BILLING_REQUIRED_FROM.
export const free = plan({
  planId: "free",
  versionSlug: "v1",
  active: true,
  name: "Free",
  group: "main",
  items: [
    { featureId: seats.featureId, included: 3, reset: { interval: "month" } },
    {
      featureId: cases.featureId,
      included: 1_000,
      reset: { interval: "month" },
    },
    {
      featureId: storage.featureId,
      included: 5_000,
      reset: { interval: "month" },
    },
    {
      featureId: modelCredit.featureId,
      included: FREE_MODEL_CREDIT_USD * CENTS,
    },
  ],
});

export const team = plan({
  planId: "team",
  versionSlug: "v1",
  active: true,
  name: "Team",
  group: "main",
  items: [
    {
      featureId: seats.featureId,
      included: 0,
      reset: { interval: "month" },
      price: { ...usagePrice, amount: 16, billingUnits: 1 },
    },
    {
      featureId: cases.featureId,
      included: 1_000,
      reset: { interval: "month" },
      price: {
        ...usagePrice,
        billingUnits: 1,
        tierBehavior: "graduated",
        tiers: [
          { to: 10_000, amount: 0.02 },
          { to: 100_000, amount: 0.01 },
          { to: "inf", amount: 0.005 },
        ],
      },
    },
    ...[modelUsage, decide, ocr].map((f) => ({
      featureId: f.featureId,
      included: 0,
      reset: { interval: "month" as const },
      price: { ...usagePrice, amount: 0.01, billingUnits: MICRO_USD_PER_CENT },
    })),
    {
      featureId: storage.featureId,
      included: 50_000,
      reset: { interval: "month" },
      price: { ...usagePrice, amount: 0.1, billingUnits: 1_000 },
    },
    { featureId: training.featureId },
    { featureId: fineTuneServing.featureId },
  ],
});

// The annual base spend (spec 16a: at least $50,000) is the commit; seats and
// usage beyond it bill monthly at Team's rates. Bigger commits are custom
// plans per customer, made when attaching.
export const enterprise = plan({
  planId: "enterprise",
  versionSlug: "v1",
  active: true,
  name: "Enterprise",
  group: "main",
  price: { amount: 50_000, interval: "year" },
  items: [
    {
      featureId: commit.featureId,
      included: 50_000 * CENTS,
      reset: { interval: "year" },
      price: { ...usagePrice, amount: 0.01, billingUnits: 1 },
    },
    ...[
      sso,
      scim,
      syncedGroups,
      customRoles,
      auditExport,
      training,
      fineTuneServing,
    ].map((f) => ({ featureId: f.featureId })),
  ],
});

// Preprocess's own organizations: everything, no limits, no price. Never
// sold; the API attaches it to the organizations BILLING_INTERNAL_ORGS names.
export const internal = plan({
  planId: "internal",
  versionSlug: "v1",
  active: true,
  name: "Internal",
  group: "main",
  items: [
    ...[seats, cases, modelUsage, decide, ocr, storage].map((f) => ({
      featureId: f.featureId,
      unlimited: true,
    })),
    ...[
      sso,
      scim,
      syncedGroups,
      customRoles,
      auditExport,
      training,
      fineTuneServing,
    ].map((f) => ({ featureId: f.featureId })),
  ],
});

export default atmn({
  features: [
    seats,
    cases,
    modelUsage,
    decide,
    ocr,
    storage,
    modelCredit,
    commit,
    sso,
    scim,
    syncedGroups,
    customRoles,
    auditExport,
    training,
    fineTuneServing,
  ],
  plans: [free, team, enterprise, internal],
});
