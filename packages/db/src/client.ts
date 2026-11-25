// The only way product code reaches Postgres (design doc 01, spec 15).
//
// withOrg runs a transaction on the DB binding (role preprocess_app, RLS
// enforced) with app.org_id set for that transaction only, so every query sees
// one organization's rows. withoutOrg is the visible escape hatch: it runs on
// DB_SYSTEM (RLS bypassed) and logs why. Each call opens its own connection,
// never one held across requests (PLAT-27).

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

export type OrgId = string & { readonly __brand: "OrgId" };

// Brand an organization id only after the caller's membership or credential
// was checked against it.
export const orgId = (id: string): OrgId => {
  if (!id) throw new Error("organization id is empty");
  return id as OrgId;
};

export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type SystemTx = Tx & { readonly __system: true };

export type DbEnv = {
  DB: Hyperdrive | { connectionString: string };
  DB_SYSTEM: Hyperdrive | { connectionString: string };
};

const connect = async <T>(
  connectionString: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(drizzle(client, { casing: "snake_case" }));
  } finally {
    // Closing the socket makes the Workers socket reader reject after pg has
    // stopped listening; that rejection is expected and carries nothing.
    client.on("error", () => {});
    await client.end();
  }
};

export const withOrg = <T>(
  env: DbEnv,
  org: OrgId,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> => {
  if (!org) throw new Error("withOrg needs an organization");
  return connect(env.DB.connectionString, (db) =>
    db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ bypass: boolean }>(
        sql`select set_config('app.org_id', ${org}, true), (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) as bypass`,
      );
      if (rows[0]?.bypass)
        throw new Error("DB bypasses row-level security; it must not");
      return fn(tx);
    }),
  );
};

export const withoutOrg = <T>(
  env: DbEnv,
  reason: string,
  fn: (tx: SystemTx) => Promise<T>,
): Promise<T> => {
  console.log(JSON.stringify({ escape: "withoutOrg", reason }));
  return connect(env.DB_SYSTEM.connectionString, (db) =>
    db.transaction((tx) => fn(tx as SystemTx)),
  );
};
