// The training switch (spec 12a, design doc 10), read only here. Our cloud
// always offers Training; a self-hosted install turns it on with
// TRAINING_SERVICE=on. It decides only whether the training routes answer
// (501 coming_soon) or hide (404); capture, datasets, export, environments,
// evals and model registration never read it.

import { runMode } from "@preprocess/runmode";

import type { Env } from "./env.ts";

export const trainingEnabled = (
  env: Pick<Env, "PREPROCESS_REGION" | "TRAINING_SERVICE">,
) => runMode(env).kind === "cloud" || env.TRAINING_SERVICE === "on";
