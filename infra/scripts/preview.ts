// Deploys or destroys one pull request stage and prints its outputs as JSON.
// CI runs it from .github/workflows/preview.yml:
//   pnpm --filter @preprocess/infra preview:deploy pr-42
//   pnpm --filter @preprocess/infra preview:destroy pr-42
// With GITHUB_OUTPUT set, it also writes the outputs there for the PR comment.

import { appendFileSync } from "node:fs";

import * as Alchemist from "alchemy/Alchemist";
import * as Effect from "effect/Effect";

import stack from "../alchemy.run.ts";
import { isPreviewStage } from "../src/stages.ts";

const [operation, stage = ""] = process.argv.slice(2);
if (
  (operation !== "deploy" && operation !== "destroy") ||
  !isPreviewStage(stage)
) {
  console.error("usage: tsx scripts/preview.ts <deploy|destroy> pr-<number>");
  process.exit(2);
}

const output = await Effect.runPromise(
  Effect.gen(function* () {
    const plan = yield* Alchemist.plan({ stack, operation, stage });
    for (const resource of plan.resources) {
      console.error(`${resource.action} ${resource.fqn}`);
    }
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
