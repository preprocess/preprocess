// The only way product code reaches Postgres (design doc 01, spec 15).
//
// withOrg runs a transaction on the DB binding (role preprocess_app, RLS
// enforced) with app.org_id set for that transaction only, so every query sees
// one organization's rows. withoutOrg is the visible escape hatch: it runs on
// DB_SYSTEM (RLS bypassed) and logs why. Each call opens its own connection,
// never one held across requests (PLAT-27).

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
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    // Closing the socket makes the Workers socket reader reject after pg has
    // stopped listening; that rejection is expected and carries nothing.
    client.on("error", () => {});
    await client.end();
  }
};

const orm = (client: pg.Client): Db =>
  drizzle(client, { casing: "snake_case" });

// BEGIN, the role switch and the organization setting go to Postgres as one
// simple-protocol query: the same statements in the same order, in one round
// trip instead of three. Simple queries take no parameters, so the
// organization id is escaped as a literal. The bypass check is its own
// statement after SET LOCAL ROLE, so it sees the switched role.
export const withOrg = <T>(
  env: DbEnv,
  org: OrgId,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> => {
  if (!org) throw new Error("withOrg needs an organization");
  return connect(env.DB.connectionString, async (client) => {
    const setup = (await client.query(
      `begin; set local role preprocess_app; select set_config('app.org_id', ${client.escapeLiteral(org)}, true), (select bool_or(rolsuper or rolbypassrls) from pg_roles where rolname in (current_user, session_user)) as bypass`,
    )) as unknown as pg.QueryResult<{ bypass: boolean }>[];
    try {
      if (setup.at(-1)?.rows[0]?.bypass)
        throw new Error("DB bypasses row-level security; it must not");
      const result = await fn(orm(client) as unknown as Tx);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
  });
};

export const withoutOrg = <T>(
  env: DbEnv,
  reason: string,
  fn: (tx: SystemTx) => Promise<T>,
): Promise<T> => {
  console.log(JSON.stringify({ escape: "withoutOrg", reason }));
  return connect(env.DB_SYSTEM.connectionString, (client) =>
    orm(client).transaction((tx) => fn(tx as SystemTx)),
  );
};

// withoutOrg without a transaction, for reads whose writes (if any) are each
// a single statement, such as resolving a session. Saves BEGIN and COMMIT.
export const withoutOrgRead = <T>(
  env: DbEnv,
  reason: string,
  fn: (tx: SystemTx) => Promise<T>,
): Promise<T> => {
  console.log(JSON.stringify({ escape: "withoutOrg", reason }));
  return connect(env.DB_SYSTEM.connectionString, (client) =>
    fn(orm(client) as unknown as SystemTx),
  );
};
