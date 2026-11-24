import { env } from "cloudflare:workers";

import { storeBundle } from "../src/dispatch.ts";
import type { Deployment, DeploymentRef } from "../src/env.ts";

const platform = env.PLATFORM as unknown as {
  setSecrets(d: DeploymentRef, values: Record<string, string>): Promise<void>;
};

// A deployment as the deploy path leaves it: the bundle stored with its hash,
// and the secrets the platform gives its code.
export const deploy = async (
  d: DeploymentRef,
  code: string,
  secrets: Record<string, string> = {},
): Promise<Pick<Deployment, "deploymentId" | "bundleHash">> => {
  const bundleHash = await storeBundle(env, d, {
    mainModule: "agent.js",
    modules: { "agent.js": code },
  });
  await platform.setSecrets(d, secrets);
  return { deploymentId: d.deploymentId, bundleHash };
};

export const setSecrets = (d: DeploymentRef, values: Record<string, string>) =>
  platform.setSecrets(d, values);
