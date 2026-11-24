// Applies migrations/*.sql in order, once each, tracked in __local_migrations,
// to a local Postgres (pnpm dev, tests). Deployed stages apply the same files
// through Alchemy's PlanetScale branch instead, after bootstrap.sql.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

export const localDatabaseUrl = (database: string) =>
  `postgresql://preprocess:preprocess@127.0.0.1:5432/${database}`;

// The runtime roles' local connection strings. These passwords exist only on
// the local server; hosted roles get theirs from bootstrap.sql.
export const localRoleUrl = (
  url: string,
  role: "preprocess_app" | "preprocess_system" | "preprocess_audit_purge",
) => {
  const u = new URL(url);
  u.username = role;
  u.password = role;
  return u.href;
};

const dir = path.join(import.meta.dirname, "../migrations");

export const migrate = async (
  url: string,
  options: { fresh?: boolean } = {},
) => {
  const target = new URL(url);
  const database = decodeURIComponent(target.pathname.slice(1));
  const admin = new pg.Client({
    connectionString: Object.assign(new URL(url), { pathname: "/postgres" })
      .href,
  });
  await admin.connect();
  try {
    const quoted = `"${database.replaceAll('"', '""')}"`;
    if (options.fresh)
      await admin.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    const exists = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [database],
    );
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${quoted}`);
    // What bootstrap.sql does on a hosted server, with local-only passwords.
    // Roles are per server, so every local database shares them.
    await admin.query(`
      DO $$
      DECLARE r text;
      BEGIN
        FOREACH r IN ARRAY ARRAY['preprocess_app', 'preprocess_system', 'preprocess_audit_purge'] LOOP
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE ROLE %I', r);
          END IF;
          EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', r, r);
        END LOOP;
        ALTER ROLE preprocess_system BYPASSRLS;
      END
      $$`);
  } finally {
    await admin.end();
  }

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
      console.log(`applied ${file} to ${database}`);
    }
    return files.length;
  } finally {
    await client.end();
  }
};
