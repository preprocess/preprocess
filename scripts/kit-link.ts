// Installs this workspace's preprocess/kit packages from a local kit checkout,
// so a kit change can be tried here without a release: `pnpm kit:link` (kit
// beside this repository, or KIT_DIR=<path>), again after each kit change, and
// `pnpm kit:unlink` to go back to the published versions.
//
// It packs each kit package exactly as a release would (pnpm pack resolves
// kit's catalog versions) into .kit/, points pnpm overrides in
// pnpm-workspace.yaml at the tarballs, and reinstalls. Unlink before
// committing.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const workspaceFile = path.join(root, "pnpm-workspace.yaml");
const tarballs = path.join(root, ".kit");
const kit = path.resolve(root, process.env.KIT_DIR ?? "../kit");
const packages = ["runmode", "ui"];
const begin =
  "# kit:link begin (local only; run `pnpm kit:unlink` before committing)";
const end = "# kit:link end";

const current = readFileSync(workspaceFile, "utf8");
const start = current.indexOf(`\n${begin}`);
const unlinked =
  start === -1
    ? current
    : current.slice(0, start) +
      current.slice(current.indexOf(end, start) + end.length + 1);

rmSync(tarballs, { recursive: true, force: true });
let next = unlinked;
if (!process.argv.includes("--unlink")) {
  mkdirSync(tarballs);
  const overrides = packages.map((name) => {
    const dir = path.join(kit, "packages", name);
    if (!existsSync(path.join(dir, "package.json"))) {
      console.error(
        `No kit checkout at ${kit} (packages/${name} is missing). Clone preprocess/kit beside this repository or set KIT_DIR.`,
      );
      process.exit(1);
    }
    const packed = path.join(
      tarballs,
      execFileSync("pnpm", ["pack", "--pack-destination", tarballs], {
        cwd: dir,
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .at(-1)!
        .split("/")
        .at(-1)!,
    );
    // A new file name per content, so pnpm never reuses an older tarball.
    const hash = createHash("sha256")
      .update(readFileSync(packed))
      .digest("hex")
      .slice(0, 12);
    const file = `${name}-${hash}.tgz`;
    renameSync(packed, path.join(tarballs, file));
    return `  "@preprocess/${name}": "file:./.kit/${file}"`;
  });
  next = `${unlinked}\n${begin}\noverrides:\n${overrides.join("\n")}\n${end}\n`;
}

if (next !== current) writeFileSync(workspaceFile, next);
execFileSync("pnpm", ["install", "--no-frozen-lockfile"], {
  cwd: root,
  stdio: "inherit",
});
