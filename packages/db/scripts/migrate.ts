// pnpm db:migrate: applies migrations to DATABASE_URL (local Postgres by
// default), creating the database and the local runtime roles on first run.

import { localDatabaseUrl, migrate } from "./migrate-lib.ts";

const count = await migrate(
  process.env.DATABASE_URL ?? localDatabaseUrl("preprocess_development"),
);
console.log(`migrations up to date (${count})`);
