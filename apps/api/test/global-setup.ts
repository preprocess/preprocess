import {
  localDatabaseUrl,
  migrate,
} from "../../../packages/db/scripts/migrate-lib.ts";

export default async function setup() {
  await migrate(
    process.env.TEST_DATABASE_URL ?? localDatabaseUrl("preprocess_api_test"),
    {
      fresh: true,
    },
  );
}
