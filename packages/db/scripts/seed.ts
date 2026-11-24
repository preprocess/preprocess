// Loads seed.sql into DATABASE_URL (local Postgres by default). Preview
// branches load the same file through Alchemy's importFiles.

import { readFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

const url =
  process.env.DATABASE_URL ??
  "postgresql://preprocess:preprocess@127.0.0.1:5432/preprocess_development";

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(
    await readFile(path.join(import.meta.dirname, "../seed.sql"), "utf8"),
  );
  const { rows } = await client.query<{ count: string }>(
    "SELECT count(*) FROM organizations",
  );
  console.log(`seeded: ${rows[0]?.count} organizations`);
} finally {
  await client.end();
}
