// Fails the lint and the build when the help center's articles drift from
// their rules: every folder of content/articles is a known category with a
// meta.json naming it and listing every article in it, and every article is
// plain Markdown (.md) with a title, a one-sentence description and an
// updated date (YYYY-MM-DD).

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { categories } from "../src/lib/categories.ts";

const root = path.resolve(import.meta.dirname, "../content/articles");
const problems: string[] = [];
const known = new Map<string, string>(categories.map((c) => [c.slug, c.title]));

const frontmatter = (source: string) => {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(source)?.[1];
  if (block === undefined) return undefined;
  // Flat YAML: one key per line, and indented lines continue the value
  // before them, as Prettier wraps a long one.
  const fields = new Map<string, string>();
  let key: string | undefined;
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (match?.[1]) {
      key = match[1];
      fields.set(key, match[2] ?? "");
    } else if (key && /^\s+\S/.test(line))
      fields.set(key, `${fields.get(key)} ${line.trim()}`.trim());
  }
  for (const [name, value] of fields)
    fields.set(name, value.replace(/^(["'])(.*)\1$/, "$2"));
  return fields;
};

const entries = await readdir(root, { withFileTypes: true });
for (const entry of entries)
  if (!entry.isDirectory())
    problems.push(
      `${entry.name}: only category folders belong in content/articles`,
    );

const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
for (const folder of folders)
  if (!known.has(folder))
    problems.push(
      `${folder}: unknown category; the categories are ${[...known.keys()].join(", ")}`,
    );
for (const slug of known.keys())
  if (!folders.includes(slug))
    problems.push(`${slug}: category folder missing`);

for (const folder of folders.filter((f) => known.has(f))) {
  const dir = path.join(root, folder);
  const meta = await readFile(path.join(dir, "meta.json"), "utf8")
    .then((text) => JSON.parse(text) as { title?: unknown; pages?: unknown })
    .catch(() => undefined);
  if (!meta) {
    problems.push(`${folder}/meta.json: missing or not JSON`);
    continue;
  }
  if (meta.title !== known.get(folder))
    problems.push(`${folder}/meta.json: title must be "${known.get(folder)}"`);
  const pages = Array.isArray(meta.pages) ? (meta.pages as unknown[]) : [];
  if (pages.length === 0)
    problems.push(
      `${folder}/meta.json: pages must list the category's articles`,
    );

  const files = await readdir(dir);
  const articles: string[] = [];
  for (const file of files) {
    if (file === "meta.json") continue;
    if (!file.endsWith(".md")) {
      problems.push(`${folder}/${file}: articles are plain Markdown (.md)`);
      continue;
    }
    const slug = file.slice(0, -3);
    articles.push(slug);
    if (!pages.includes(slug))
      problems.push(`${folder}/${file}: not listed in ${folder}/meta.json`);
    const fields = frontmatter(await readFile(path.join(dir, file), "utf8"));
    if (!fields) {
      problems.push(`${folder}/${file}: missing frontmatter`);
      continue;
    }
    if (!fields.get("title")) problems.push(`${folder}/${file}: missing title`);
    const description = fields.get("description");
    if (!description) problems.push(`${folder}/${file}: missing description`);
    else if (!/^[^.!?]+[.!?]$/.test(description))
      problems.push(`${folder}/${file}: description must be one sentence`);
    const updated = fields.get("updated");
    if (!updated) problems.push(`${folder}/${file}: missing updated`);
    else if (
      !/^\d{4}-\d{2}-\d{2}$/.test(updated) ||
      Number.isNaN(Date.parse(updated))
    )
      problems.push(`${folder}/${file}: updated must be a YYYY-MM-DD date`);
  }
  for (const page of pages)
    if (typeof page !== "string" || !articles.includes(page))
      problems.push(
        `${folder}/meta.json: lists ${String(page)}, which has no article`,
      );
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("help center articles ok");
