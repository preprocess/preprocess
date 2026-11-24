import { localDatabaseUrl, migrate } from "@preprocess/db/migrate";

export default async function setup() {
  await migrate(
    process.env.TEST_DATABASE_URL ?? localDatabaseUrl("preprocess_api_test"),
    { fresh: true },
  );
}
