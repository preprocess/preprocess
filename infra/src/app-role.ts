// PlanetScale roles can inherit only built-in roles, so DB's login role is
// made a member of preprocess_app (migration 0001) here, by the stage's role,
// which holds admin on it. The deploy then checks that the login role can't
// bypass row-level security and fails before any Worker uses it if it can.

import type { PostgresOrigin } from "@alchemy.run/planetscale";
import { Action } from "alchemy";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import pg from "pg";

class GrantFailed extends Data.TaggedError("GrantFailed")<{
  message: string;
}> {}

const connect = async <T>(
  origin: PostgresOrigin,
  fn: (client: pg.Client) => Promise<T>,
) => {
  const client = new pg.Client({
    host: origin.host,
    port: origin.port,
    database: origin.database,
    user: origin.user,
    password: Redacted.value(origin.password),
    ssl: true,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

// The login user carries PlanetScale's routing suffix, so the Postgres role
// name is read by logging in as it.
const grant = async (admin: PostgresOrigin, app: PostgresOrigin) => {
  const user = await connect(app, async (client) => {
    const { rows } = await client.query<{ user: string }>(
      "select current_user as user",
    );
    return rows[0]!.user;
  });
  await connect(admin, async (client) => {
    await client.query(
      `GRANT preprocess_app TO ${client.escapeIdentifier(user)}`,
    );
    const { rows } = await client.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      member: boolean;
    }>(
      "select rolsuper, rolbypassrls, pg_has_role(rolname, 'preprocess_app', 'member') as member from pg_roles where rolname = $1",
      [user],
    );
    console.log(JSON.stringify({ appRole: user, ...rows[0] }));
    const role = rows[0];
    if (!role || role.rolsuper || role.rolbypassrls || !role.member)
      throw new Error(
        `${user} must be a member of preprocess_app without BYPASSRLS`,
      );
  });
};

export const GrantAppRole = Action(
  "Preprocess.GrantAppRole",
  (input: { admin: PostgresOrigin; app: PostgresOrigin }) =>
    Effect.tryPromise({
      try: () => grant(input.admin, input.app),
      catch: (error) =>
        new GrantFailed({
          message: `Granting preprocess_app failed: ${error instanceof Error ? error.message : String(error)}`,
        }),
    }).pipe(Effect.as(input.app)),
);
