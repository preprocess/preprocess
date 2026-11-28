import { localDatabaseUrl, migrate } from "@preprocess/db/migrate";

export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? localDatabaseUrl("preprocess_api_test");

// A second database for tests of install-wide rows (the uploaded license
// key), which test files running at the same time on the first would see.
export const installDatabaseUrl = Object.assign(new URL(testDatabaseUrl), {
  pathname: `${new URL(testDatabaseUrl).pathname}_install`,
}).href;

export default async function setup() {
  await Promise.all(
    [testDatabaseUrl, installDatabaseUrl].map((url) =>
      migrate(url, { fresh: true }),
    ),
  );
}
