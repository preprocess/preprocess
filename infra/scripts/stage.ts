// Deploys or destroys one stage and prints its outputs as JSON. CI runs it
// from .github/workflows/preview.yml and deploy.yml:
//   pnpm --filter @preprocess/infra preview:deploy pr-42
//   pnpm --filter @preprocess/infra preview:destroy pr-42
//   pnpm --filter @preprocess/infra staging:deploy
// A self-hosted install (`preprocess install`) plans or deploys its own stage,
// creating or upgrading the account's Alchemy state store as it goes:
//   pnpm --filter @preprocess/infra selfhost:plan selfhost
//   pnpm --filter @preprocess/infra selfhost:deploy selfhost
// Only preview stages can be destroyed here. With GITHUB_OUTPUT set, it also
// writes the outputs there for the PR comment and the smoke test.

import { appendFileSync } from "node:fs";

import * as Alchemist from "alchemy/Alchemist";
import * as Effect from "effect/Effect";

import stack from "../alchemy.run.ts";
import { isPreviewStage, isSelfHostStage } from "../src/stages.ts";

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

console.log(JSON.stringify(output ?? null, null, 2));
if (process.env.GITHUB_OUTPUT && output) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `outputs=${JSON.stringify(output)}\n`,
  );
}
