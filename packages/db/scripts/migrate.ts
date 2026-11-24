// Applies migrations/*.sql to DATABASE_URL (local Postgres by default) in
// order, once each, tracked in __local_migrations. Deployed stages apply the
// same files through Alchemy's PlanetScale branch instead.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

const url =
  process.env.DATABASE_URL ??
  "postgresql://preprocess:preprocess@127.0.0.1:5432/preprocess_development";
const dir = path.join(import.meta.dirname, "../migrations");

// Create the database on first run, using the same server and role.
const target = new URL(url);
const database = target.pathname.slice(1);
const admin = new pg.Client({
  connectionString: Object.assign(new URL(url), { pathname: "/postgres" }).href,
});
await admin.connect();
const exists = await admin.query(
  "SELECT 1 FROM pg_database WHERE datname = $1",
  [database],
);
if (exists.rowCount === 0) {
  await admin.query(`CREATE DATABASE "${database.replaceAll('"', '""')}"`);
  console.log(`created database ${database}`);
}
await admin.end();

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS __local_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const applied = new Set(
    (
      await client.query<{ name: string }>(
        "SELECT name FROM __local_migrations",
      )
    ).rows.map((row) => row.name),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await client.query("BEGIN");
    await client.query(sql.replaceAll("--> statement-breakpoint", ""));
    await client.query("INSERT INTO __local_migrations (name) VALUES ($1)", [
      file,
    ]);
    await client.query("COMMIT");
    console.log(`applied ${file}`);
  }
  console.log(`migrations up to date (${files.length})`);
} finally {
  await client.end();
}
