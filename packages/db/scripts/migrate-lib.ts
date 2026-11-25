// Applies migrations/*.sql in order, once each, tracked in __local_migrations.
// migrate() serves a local Postgres (pnpm dev, tests). install() serves a
// self-hosted install's own Postgres: bootstrap.sql, then the migrations as
// preprocess_migrator. Our cloud's stages apply the same files through
// Alchemy's PlanetScale branch instead, after bootstrap.sql.

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
const bootstrapFile = path.join(import.meta.dirname, "../bootstrap.sql");

const applyMigrations = async (url: string) => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const database = decodeURIComponent(new URL(url).pathname.slice(1));
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
          -- Test suites migrate their databases in parallel on one server,
          -- so two of them can both find a role missing and race to create it.
          BEGIN
            EXECUTE format('CREATE ROLE %I', r);
          EXCEPTION WHEN duplicate_object OR unique_violation THEN
            NULL;
          END;
          EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', r, r);
        END LOOP;
        ALTER ROLE preprocess_system BYPASSRLS;
      END
      $$`);
  } finally {
    await admin.end();
  }

  return applyMigrations(url);
};

export type RolePasswords = {
  migrator_password: string;
  app_password: string;
  system_password: string;
  purge_password: string;
};

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

// The role's connection string on the same server and database as url.
export const roleUrl = (url: string, role: string, password: string) => {
  const u = new URL(url);
  u.username = role;
  u.password = password;
  return u.href;
};

// A self-hosted install's database (spec 16): bootstrap.sql as the
// administrator in adminUrl, exactly as psql would run it with -v for each
// password, then every pending migration as preprocess_migrator. Safe to rerun
// on every deploy: bootstrap only resets the passwords, and applied migrations
// are skipped.
export const install = async (adminUrl: string, passwords: RolePasswords) => {
  const sql = (await readFile(bootstrapFile, "utf8")).replace(
    /:'(\w+)'/g,
    (_, name: string) => {
      const value = passwords[name as keyof RolePasswords];
      if (value === undefined)
        throw new Error(`bootstrap.sql uses :'${name}', which install() lacks`);
      return literal(value);
    },
  );
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // Each chunk before a \gexec ends in a query whose every result cell is
    // itself a statement to run, as psql's \gexec does.
    const chunks = sql.split(/^\\gexec$/m);
    for (const [i, chunk] of chunks.entries()) {
      const results = [await admin.query<Record<string, string>>(chunk)].flat();
      if (i === chunks.length - 1) break;
      for (const row of results.at(-1)?.rows ?? [])
        for (const statement of Object.values(row))
          await admin.query(String(statement));
    }
  } finally {
    await admin.end();
  }
  return applyMigrations(
    roleUrl(adminUrl, "preprocess_migrator", passwords.migrator_password),
  );
};
