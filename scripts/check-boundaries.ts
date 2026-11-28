// Packages under packages/ must stay publishable and reusable by other
// Preprocess, Inc. products (spec 16): each has its own name, version and
// exports, and none imports from apps/. Apps deploy on their own, so none
// imports another app's source either (the help center shares the docs'
// search through packages/search). Fails listing every violation.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const appDirs = await readdir(path.join(root, "apps"));
const apps = await Promise.all(
  appDirs.map(
    async (dir) =>
      (
        JSON.parse(
          await readFile(path.join(root, "apps", dir, "package.json"), "utf8"),
        ) as { name: string }
      ).name,
  ),
);

const problems: string[] = [];
const walk = async (dir: string): Promise<string[]> =>
  (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory())
          return entry.name === "node_modules" ? [] : walk(full);
        return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : [];
      }),
    )
  ).flat();

for (const dir of await readdir(path.join(root, "packages"))) {
  const pkgDir = path.join(root, "packages", dir);
  // A directory holding only a LICENSE (sdk, cli) has no package yet.
  const manifest = await readFile(
    path.join(pkgDir, "package.json"),
    "utf8",
  ).catch(() => null);
  if (manifest === null) continue;
  const pkg = JSON.parse(manifest) as {
    name?: string;
    version?: string;
    exports?: unknown;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  if (!pkg.name || !pkg.version || !pkg.exports) {
    problems.push(
      `packages/${dir}: package.json needs name, version and exports`,
    );
  }
  for (const dep of Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
  })) {
    if (apps.includes(dep))
      problems.push(`packages/${dir}: depends on app ${dep}`);
  }
  for (const file of await walk(pkgDir)) {
    const source = await readFile(file, "utf8");
    for (const [, spec] of source.matchAll(
      /(?:from|import)\s*\(?\s*["']([^"']+)["']/g,
    )) {
      const resolved = spec.startsWith(".")
        ? path.resolve(path.dirname(file), spec)
        : "";
      if (
        apps.some((app) => spec === app || spec.startsWith(`${app}/`)) ||
        resolved.startsWith(path.join(root, "apps"))
      ) {
        problems.push(
          `${path.relative(root, file)}: imports ${spec} from an app`,
        );
      }
    }
  }
}

for (const [index, dir] of appDirs.entries()) {
  const appDir = path.join(root, "apps", dir);
  for (const file of await walk(path.join(appDir, "src")).catch(() => [])) {
    const source = await readFile(file, "utf8");
    for (const [, spec] of source.matchAll(
      /(?:from|import)\s*\(?\s*["']([^"']+)["']/g,
    )) {
      const resolved = spec.startsWith(".")
        ? path.resolve(path.dirname(file), spec)
        : "";
      const other = apps.find(
        (app, at) =>
          at !== index && (spec === app || spec.startsWith(`${app}/`)),
      );
      if (
        other ||
        (resolved.startsWith(path.join(root, "apps")) &&
          !resolved.startsWith(appDir + path.sep))
      )
        problems.push(
          `${path.relative(root, file)}: imports ${spec} from another app`,
        );
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("package boundaries ok");
