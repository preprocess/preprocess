// Bundles the agent with the CLI's own bundle(), the code path
// `preprocess deploy` takes, and writes the result for the Worker to read.

import { writeFileSync } from "node:fs";

import { bundle } from "/opt/preprocess/cli/src/deploy.ts";

const [entry, out] = process.argv.slice(2);
if (!entry || !out) throw new Error("usage: bundle.ts <entry> <out>");
writeFileSync(out, JSON.stringify(await bundle(entry)));
