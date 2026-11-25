import pg from "pg";

import { localDatabaseUrl, migrate } from "../scripts/migrate-lib.ts";

// Login roles shaped like the ones deployed stages get from PlanetScale: a
// separate login role that is a member of preprocess_app, as DB is on every
// stage, and one that also bypasses RLS, which withOrg must refuse.
const deployedRoles = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preprocess_test_member') THEN
      CREATE ROLE preprocess_test_member;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preprocess_test_bypass') THEN
      CREATE ROLE preprocess_test_bypass;
    END IF;
  END
  $$;
  ALTER ROLE preprocess_test_member LOGIN INHERIT NOBYPASSRLS PASSWORD 'preprocess_test_member';
  ALTER ROLE preprocess_test_bypass LOGIN INHERIT BYPASSRLS PASSWORD 'preprocess_test_bypass';
  GRANT preprocess_app TO preprocess_test_member, preprocess_test_bypass;
`;

export default async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? localDatabaseUrl("preprocess_test_db");
  await migrate(url, { fresh: true });
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(deployedRoles);
  } finally {
    await client.end();
  }
}
