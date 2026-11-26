// The registry's command line (src/registry.ts). Needs CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID; .github/workflows/registry.yml runs it daily.
//   pnpm --filter @preprocess/infra registry usage
//   pnpm --filter @preprocess/infra registry sweep [open pull request numbers...]
// usage prints the estimate. Its first summary line is always
// REGISTRY_USAGE_GB=<n>, which alerting reads. In GitHub Actions it adds a
// warning annotation from 35 GB of the 50 GB cap, and from 42 GB it fails.
// sweep deletes the images no Worker
// references; scripts/stage.ts deletes a preview's own images when it destroys
// the preview.

import { appendFileSync } from "node:fs";

import {
  type Cleaned,
  credentials,
  sweep,
  failAtBytes,
  usage,
  warnAtBytes,
} from "../src/registry.ts";

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(2)} GB`;
const [command, ...args] = process.argv.slice(2);

const report = (cleaned: Cleaned[]) => {
  for (const { repository, deleted, refused, bytes } of cleaned) {
    console.log(`${repository}: deleted ${deleted} tags, about ${gb(bytes)}`);
    for (const refusal of refused) console.log(`  refused ${refusal}`);
  }
  const total = cleaned.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(
    `${cleaned.length} repositories, about ${gb(total)} of manifests deleted`,
  );
};

if (command === "usage") {
  const result = await usage(await credentials());
  const lines = [
    `REGISTRY_USAGE_GB=${(result.uniqueBytes / 1e9).toFixed(2)}`,
    "",
    `Container registry: ${gb(result.uniqueBytes)} of unique blobs in ${result.repositories} repositories (${gb(result.perRepositoryBytes)} counting each repository in full; ${gb(result.chainBytes)} of it prepared btrfs chains). Cap 50 GB, warning at ${gb(warnAtBytes)}, failing at ${gb(failAtBytes)}.`,
    "",
    "| Repositories | Count | Tags | Unique blobs |",
    "| --- | --- | --- | --- |",
    ...result.groups.map(
      (group) =>
        `| ${group.name} | ${group.repositories} | ${group.tags} | ${gb(group.bytes)} |`,
    ),
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
  if (result.uniqueBytes >= failAtBytes) {
    console.log(
      `::error title=Container registry at its limit::${gb(result.uniqueBytes)} of the account's 50 GB registry is used, at or above ${gb(failAtBytes)}. See infra/README.md (Container registry).`,
    );
    process.exit(1);
  }
  if (result.uniqueBytes >= warnAtBytes && process.env.GITHUB_ACTIONS) {
    console.log(
      `::warning title=Container registry near its cap::${gb(result.uniqueBytes)} of the account's 50 GB registry is used. Run the Registry workflow's sweep, and see infra/README.md (Container registry).`,
    );
  }
} else if (command === "sweep" && args.every((arg) => /^\d+$/.test(arg))) {
  report(await sweep(await credentials(), new Set(args.map(Number))));
} else {
  console.error(
    "usage: tsx scripts/registry.ts usage | sweep [open pull request numbers...]",
  );
  process.exit(2);
}
