// Writes the API's OpenAPI document (GET /v1/openapi.json) to a file, for the
// docs site's API reference. The Worker is bundled for Node with Cloudflare's
// runtime modules stubbed; serving the document touches no binding.
//
//   pnpm --filter @preprocess/api openapi <out.json>

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

const out = path.resolve(process.argv[2] ?? "openapi.json");
const dir = path.join(import.meta.dirname, "../.openapi");
const bundle = path.join(dir, "api.mjs");

await mkdir(dir, { recursive: true });
await build({
  entryPoints: [path.join(import.meta.dirname, "../src/index.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  plugins: [
    {
      name: "cloudflare-stubs",
      setup(b) {
        b.onResolve({ filter: /^cloudflare:/ }, (args) => ({
          path: args.path,
          namespace: "cloudflare-stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "cloudflare-stub" }, () => ({
          contents:
            "export class WorkerEntrypoint {} export class DurableObject {} export class WorkflowEntrypoint {} export const env = {};",
          loader: "js",
        }));
      },
    },
  ],
});
const worker = (await import(pathToFileURL(bundle).href)) as {
  default: { fetch: (request: Request, env: unknown) => Promise<Response> };
};
const response = await worker.default.fetch(
  new Request("http://api.local/v1/openapi.json"),
  {},
);
if (!response.ok) throw new Error(`openapi.json answered ${response.status}`);
await writeFile(out, JSON.stringify(await response.json(), null, 2) + "\n");
await rm(dir, { recursive: true });
console.log(`wrote ${path.relative(process.cwd(), out)}`);
