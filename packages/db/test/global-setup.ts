import { localDatabaseUrl, migrate } from "../scripts/migrate-lib.ts";

export default async function setup() {
  await migrate(
    process.env.TEST_DATABASE_URL ?? localDatabaseUrl("preprocess_test_db"),
    { fresh: true },
  );
}
