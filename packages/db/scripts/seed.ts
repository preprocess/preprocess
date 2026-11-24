// Loads seed.sql into DATABASE_URL (local Postgres by default). Preview
// branches load the same file through Alchemy's importFiles.

import { readFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { localDatabaseUrl } from "./migrate-lib.ts";

const client = new pg.Client({
  connectionString:
    process.env.DATABASE_URL ?? localDatabaseUrl("preprocess_development"),
});
await client.connect();
try {
  await client.query(
    await readFile(path.join(import.meta.dirname, "../seed.sql"), "utf8"),
  );
  console.log("seeded");
} finally {
  await client.end();
}
