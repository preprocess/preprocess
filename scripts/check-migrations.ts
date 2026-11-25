// Expand and contract (AGENTS.md, Migrations): every deploy applies
// migrations while the previous code still serves, so a migration must work
// with both. This compares a branch with its base and fails when:
// - a migration already on the base was edited or deleted (deployed stages
//   have applied it; Alchemy refuses changed history), or
// - a new migration drops, renames or narrows something the previous code may
//   still use, unless the file says why that is safe with a
//   `-- contract: <reason>` line (the previous release no longer reads or
//   writes it).
//
//   node scripts/check-migrations.ts [base-ref]   (default origin/main)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "origin/main";
const dir = "packages/db/migrations";
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();

const mergeBase = git("merge-base", base, "HEAD");
const changes = git(
  "diff",
  "--name-status",
  "--no-renames",
  mergeBase,
  "HEAD",
  "--",
  `${dir}/*.sql`,
)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status = "", file = ""] = line.split("\t");
    return { status, file };
  });

// Statements that can break code written before the migration.
const contracting: [(sql: string) => boolean, string][] = [
  [(s) => /\bdrop\s+table\b/i.test(s), "drops a table"],
  [(s) => /\bdrop\s+column\b/i.test(s), "drops a column"],
  [(s) => /\bdrop\s+(type|view|function|schema)\b/i.test(s), "drops an object"],
  [(s) => /\brename\b/i.test(s), "renames something"],
  [
    (s) => /\balter\s+column\s+\S+\s+(set\s+data\s+)?type\b/i.test(s),
    "changes a column type",
  ],
  [
    (s) => /\balter\s+column\s+\S+\s+set\s+not\s+null\b/i.test(s),
    "makes a column NOT NULL",
  ],
  // Inserts from the previous code don't name the new column.
  [
    (s) =>
      /\badd\s+column\b/i.test(s) &&
      /\bnot\s+null\b/i.test(s) &&
      !/\bdefault\b/i.test(s),
    "adds a NOT NULL column without a default",
  ],
];

const problems: string[] = [];
for (const { status, file } of changes) {
  if (status !== "A") {
    problems.push(
      `${file}: ${status === "D" ? "deleted" : "edited"} after it reached main. Add a new migration instead.`,
    );
    continue;
  }
  const sql = readFileSync(file, "utf8");
  if (/^\s*--\s*contract:\s*\S/im.test(sql)) continue;
  for (const statement of sql.split(/;|--> statement-breakpoint/)) {
    const code = statement.replace(/--.*$/gm, "");
    for (const [breaks, what] of contracting) {
      if (breaks(code)) {
        problems.push(
          `${file}: ${what} (${code.trim().split("\n")[0]}). Expand first; contract in a later release with a "-- contract: <reason>" line.`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `Migrations OK: ${changes.length} changed against ${base}, all expand-only.`,
);
