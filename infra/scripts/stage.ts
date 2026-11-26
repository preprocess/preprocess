// Deploys or destroys one stage and prints its outputs as JSON. CI runs it
// from .github/workflows/preview.yml and deploy.yml:
//   pnpm --filter @preprocess/infra preview:deploy pr-42
//   pnpm --filter @preprocess/infra preview:destroy pr-42
//   pnpm --filter @preprocess/infra staging:deploy
// A self-hosted install (`preprocess install`) plans or deploys its own stage,
// creating or upgrading the account's Alchemy state store as it goes:
//   pnpm --filter @preprocess/infra selfhost:plan selfhost
//   pnpm --filter @preprocess/infra selfhost:deploy selfhost
// Only preview stages can be destroyed here, and their R2 buckets are emptied
// first: R2 refuses to delete a bucket that still holds objects. Their
// container images are deleted from the registry afterwards. With
// GITHUB_OUTPUT set, it also writes the outputs there for the PR comment and
// the smoke test.

import { appendFileSync } from "node:fs";

import * as Alchemist from "alchemy/Alchemist";
import * as Effect from "effect/Effect";

import stack from "../alchemy.run.ts";
import { cleanStage, credentials, stageImages } from "../src/registry.ts";
import { isPreviewStage, isSelfHostStage, names } from "../src/stages.ts";

const [operation, stage = ""] = process.argv.slice(2);
const selfHost = isSelfHostStage(stage);
const allowed =
  (operation === "deploy" &&
    (isPreviewStage(stage) || stage === "staging" || selfHost)) ||
  (operation === "plan" && selfHost) ||
  (operation === "destroy" && isPreviewStage(stage));
if (!allowed) {
  console.error(
    "usage: tsx scripts/stage.ts deploy <pr-<number>|staging|selfhost[-<name>]> | plan selfhost[-<name>] | destroy pr-<number>",
  );
  process.exit(2);
}

const emptyBucket = async (bucket: string) => {
  const objects = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${bucket}/objects`;
  const headers = {
    authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    "content-type": "application/json",
  };
  for (;;) {
    const listed = await fetch(`${objects}?per_page=1000`, { headers });
    if (listed.status === 404) return;
    if (!listed.ok) {
      throw new Error(
        `listing ${bucket}: ${listed.status} ${await listed.text()}`,
      );
    }
    const { result } = (await listed.json()) as { result: { key: string }[] };
    if (result.length === 0) return;
    const deleted = await fetch(objects, {
      method: "DELETE",
      headers,
      body: JSON.stringify(result.map((object) => object.key)),
    });
    if (!deleted.ok) {
      throw new Error(
        `emptying ${bucket}: ${deleted.status} ${await deleted.text()}`,
      );
    }
    console.error(`emptied ${result.length} objects from ${bucket}`);
  }
};

// Its container images, read while its Workers still exist, are deleted from
// the registry once the stage is gone (src/registry.ts).
const registry =
  operation === "destroy" && isPreviewStage(stage)
    ? await credentials()
    : undefined;
const images = registry ? await stageImages(registry, stage) : undefined;

if (operation === "destroy") {
  const n = names(stage);
  await Promise.all(
    [n.bucket, n.logs, n.auditBucket, n.runs, n.bundles].map(emptyBucket),
  );
}

const output = await Effect.runPromise(
  Effect.gen(function* () {
    const plan = yield* Alchemist.plan({
      stack,
      operation: operation === "destroy" ? "destroy" : "deploy",
      stage,
      updateStateStore: selfHost,
    });
    for (const resource of plan.resources) {
      console.error(`${resource.action} ${resource.fqn}`);
    }
    if (operation === "plan") return null;
    return yield* Alchemist.apply(plan);
  }).pipe(Effect.provide(Alchemist.layer()), Effect.scoped),
);

if (registry && images && isPreviewStage(stage)) {
  // A merged pull request's images are main's too: main builds the same
  // inputs, so they stay until the registry sweep finds them unreferenced.
  const merged = process.env.PR_MERGED === "true";
  for (const cleaned of await cleanStage(registry, stage, images, { merged })) {
    console.error(
      `registry: ${cleaned.repository}: deleted ${cleaned.deleted} tags${cleaned.refused.length ? `, ${cleaned.refused.length} refused` : ""}`,
    );
  }
}

console.log(JSON.stringify(output ?? null, null, 2));
if (process.env.GITHUB_OUTPUT && output) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `outputs=${JSON.stringify(output)}\n`,
  );
}
