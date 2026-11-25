// A self-hosted install's own Postgres (spec 16), reached through any admin
// connection string in DATABASE_URL. Each deploy runs bootstrap.sql and every
// pending migration before any Worker that uses the database is updated, the
// same order PlanetScale stages get from Alchemy. Destroying the stage leaves
// the database alone: it is the customer's data.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { install } from "@preprocess/db/migrate";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

type Password = Redacted.Redacted<string>;

export type Props = {
  url: Password;
  passwords: {
    migrator_password: Password;
    app_password: Password;
    system_password: Password;
    purge_password: Password;
  };
  // Changes whenever bootstrap.sql or a migration does, so a deploy with new
  // migrations reconciles this resource.
  digest: string;
};

export type SelfHostDatabase = Resource<
  "Preprocess.SelfHostDatabase",
  Props,
  { digest: string }
>;

export const SelfHostDatabase = Resource<SelfHostDatabase>(
  "Preprocess.SelfHostDatabase",
);

class InstallFailed extends Data.TaggedError("InstallFailed")<{
  message: string;
}> {}

export const SelfHostDatabaseProvider = () =>
  Provider.succeed(SelfHostDatabase, {
    reconcile: ({ news }) =>
      Effect.tryPromise({
        try: () =>
          install(
            Redacted.value(news.url),
            Object.fromEntries(
              Object.entries(news.passwords).map(([name, value]) => [
                name,
                Redacted.value(value),
              ]),
            ) as Parameters<typeof install>[1],
          ),
        catch: (error) =>
          new InstallFailed({
            message: `Postgres install failed: ${error instanceof Error ? error.message : String(error)}`,
          }),
      }).pipe(Effect.as({ digest: news.digest })),
    delete: () => Effect.void,
    read: ({ output }) => Effect.succeed(output),
  });

export const schemaDigest = (dbPackage: string) => {
  const hash = createHash("sha256");
  const migrations = path.join(dbPackage, "migrations");
  for (const file of [
    path.join(dbPackage, "bootstrap.sql"),
    ...readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => path.join(migrations, name)),
  ]) {
    hash.update(path.basename(file)).update(readFileSync(file));
  }
  return hash.digest("hex");
};

// Hyperdrive origin for one runtime role on the server in DATABASE_URL.
export const roleOrigin = (url: string, user: string, password: Password) => {
  const u = new URL(url);
  return {
    scheme: "postgres" as const,
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.slice(1)),
    user,
    password,
  };
};
