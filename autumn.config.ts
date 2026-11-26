// Our cloud's plans as code (spec 16a, PRE-39). Nobody edits plans in
// Autumn's dashboard or over MCP: change this file in a pull request. CI
// previews it against the sandbox on every pull request, the staging deploy
// applies it to the sandbox, and the production deploy applies it to the live
// environment and stops for an explicit go if existing customers' plans
// would change. A self-hosted install never reads it.
//
// Units the app tracks (apps/api/src/billing.ts): model, decide, OCR,
// sandbox and case-fee usage in credits of $0.01, converted from the
// micro-USD our prices give (packages/models/src/prices.ts,
// apps/runtime/src/models.ts, apps/api/src/sandbox.ts,
// apps/api/src/metering.ts); storage in GB-months, tracked daily; seats as
// active seat-months, tracked when a month closes. Only whole credits and
// GB-months are sent; the rest carries into the next report, so nothing
// rounds up. Credit systems count credits too.
//
// Free and Team pay for a case's usage from prepaid Credits (PRE-96): Free
// starts with $5 of them, and both buy more by hand or by auto-reload. Seats
// and storage past the allowance stay a monthly card charge. Usage reported
// past the balance is kept as debt that the next top-up pays.

import { atmn, feature, plan } from "atmn";

// The one-time model credit a Free organization gets (Chip, 2026-11-26:
// "One time $5"), in dollars.
const FREE_MODEL_CREDIT_USD = 5;

// Training is priced at 2.5 times what its provider charges us. Training is
// Coming soon and its provider is undecided (spec 12a), so nothing bills it.
export const TRAINING_MULTIPLIER = 2.5;

const CREDITS_PER_USD = 100;

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
  featureId: "model_usage_credits",
  name: "Model usage credit",
  type: "metered",
  consumable: true,
});

export const decide = feature({
  featureId: "decide_credits",
  name: "decide usage credit",
  type: "metered",
  consumable: true,
});

export const ocr = feature({
  featureId: "ocr_credits",
  name: "OCR usage credit",
  type: "metered",
  consumable: true,
});

export const sandbox = feature({
  featureId: "sandbox_credits",
  name: "Sandbox usage credit",
  type: "metered",
  consumable: true,
});

// Case fees, priced per case in our own ledger by the month's case count
// (apps/api/src/metering.ts).
export const caseFees = feature({
  featureId: "case_fee_credits",
  name: "Case fee credit",
  type: "metered",
  consumable: true,
});

export const storage = feature({
  featureId: "storage_gb_months",
  name: "GB-month",
  type: "metered",
  consumable: true,
});

// The prepaid balance a case's usage draws on. The id predates prepaid
// credits; keeping it carries Free's existing $5 over.
export const credits = feature({
  featureId: "model_credit",
  name: "Credits",
  type: "credit_system",
  creditSchema: [modelUsage, decide, ocr, sandbox, caseFees].map((f) => ({
    meteredFeatureId: f.featureId,
    creditCost: 1,
  })),
});

// Enterprise's annual commit, which seats and all usage draw down at the
// same rates Team pays.
export const commit = feature({
  featureId: "commit",
  name: "Committed spend",
  type: "credit_system",
  creditSchema: [
    { meteredFeatureId: seats.featureId, creditCost: 16 * CREDITS_PER_USD },
    ...[modelUsage, decide, ocr, sandbox, caseFees].map((f) => ({
      meteredFeatureId: f.featureId,
      creditCost: 1,
    })),
    {
      meteredFeatureId: storage.featureId,
      tierBehavior: "graduated",
      tiers: [
        { to: 50, creditCost: 0 },
        { to: "inf", creditCost: 10 },
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
// Agents' own sandbox images (Chip: "lets lock custom images to team").
// Presets and the package list stay on every plan.
export const customSandboxImages = flag(
  "custom_sandbox_images",
  "Custom sandbox images",
);

const usagePrice = {
  billingMethod: "usage_based",
  interval: "month",
} as const;

// Credits bought by hand or by auto-reload, at $0.01 each.
const topUp = {
  featureId: credits.featureId,
  price: {
    amount: 0.01,
    billingUnits: 1,
    billingMethod: "prepaid",
    interval: "one_off",
  },
} as const;

// Usage reported past the balance becomes debt instead of being lost; the
// app's credit stop reads the balance itself (apps/api/src/billing.ts).
const prepaidControls = {
  overageAllowed: [{ featureId: credits.featureId, enabled: true }],
};

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
    // Storage past 5 GB is billed to the card as on Team (PRE-96), never
    // drawn from credits; a hard cap would stop an organization that left
    // Team with more.
    {
      featureId: storage.featureId,
      included: 5,
      reset: { interval: "month" },
      price: { ...usagePrice, amount: 0.1, billingUnits: 1 },
    },
    {
      featureId: credits.featureId,
      included: FREE_MODEL_CREDIT_USD * CREDITS_PER_USD,
    },
  ],
  billingControls: prepaidControls,
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
    { featureId: cases.featureId, unlimited: true },
    {
      featureId: storage.featureId,
      included: 50,
      reset: { interval: "month" },
      price: { ...usagePrice, amount: 0.1, billingUnits: 1 },
    },
    { featureId: training.featureId },
    { featureId: fineTuneServing.featureId },
    { featureId: customSandboxImages.featureId },
  ],
  billingControls: prepaidControls,
});

// Credits bought by hand or by auto-reload, on Free and Team alike: an
// add-on bought as often as needed, in any quantity.
export const creditTopUp = plan({
  planId: "credits",
  versionSlug: "v1",
  active: true,
  name: "Credits",
  addOn: true,
  items: [topUp],
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
      included: 50_000 * CREDITS_PER_USD,
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
      customSandboxImages,
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
    ...[
      seats,
      cases,
      modelUsage,
      decide,
      ocr,
      sandbox,
      caseFees,
      storage,
      credits,
    ].map((f) => ({
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
      customSandboxImages,
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
    sandbox,
    caseFees,
    storage,
    credits,
    commit,
    sso,
    scim,
    syncedGroups,
    customRoles,
    auditExport,
    training,
    fineTuneServing,
    customSandboxImages,
  ],
  plans: [free, team, creditTopUp, enterprise, internal],
});
