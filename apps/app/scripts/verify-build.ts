import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const outputDirectories = [
  path.resolve("dist/client"),
  path.resolve("dist/server"),
];

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(entryPath) : [entryPath];
    }),
  );
  return files.flat();
}

const files = (
  await Promise.all(outputDirectories.map((directory) => walk(directory)))
).flat();
const workerAssets = files.filter((file) =>
  /pdf\.worker\.min-[\w-]+\.mjs$/.test(file),
);
const sourceFiles = files.filter((file) => /\.(?:js|mjs)$/.test(file));
const sources = await Promise.all(
  sourceFiles.map(async (file) => ({
    content: await readFile(file, "utf8"),
  })),
);
if (process.env.EXPECT_PDF_WORKER === "present") {
  assert.ok(
    workerAssets.length > 0,
    "Cloudflare/Vite build did not emit the shared UI PDF.js worker ?url asset",
  );

  const referencesWorker = workerAssets.some((workerAsset) =>
    sources.some(({ content }) => content.includes(path.basename(workerAsset))),
  );

  assert.ok(
    referencesWorker,
    "Cloudflare/Vite output emitted the PDF.js worker without a bundle reference",
  );
  console.log(
    "Verified the shared UI *?url declaration and PDF.js worker import.",
  );
} else {
  assert.equal(
    workerAssets.length,
    0,
    "Regular shell build unexpectedly includes the PDF.js bundle probe",
  );
  console.log("Verified the regular shell build excludes the PDF.js probe.");
}

// The preview sign-in (src/preview) must never reach a deployable bundle.
if (process.env.EXPECT_PREVIEW_SIGN_IN === "absent") {
  assert.ok(
    sources.every(
      ({ content }) => !content.includes("preprocess-preview-session"),
    ),
    "Build includes the preview sign-in",
  );
  console.log("Verified the build excludes the preview sign-in.");
}
