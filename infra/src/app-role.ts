// PlanetScale roles can inherit only built-in roles, so DB's login role is
// made a member of preprocess_app (migration 0001) here, by the stage's role,
// which holds admin on it. The deploy then checks that the login role can't
// bypass row-level security and fails before any Worker uses it if it can.
// It also fails when the server can't take both Hyperdrive pools at their
// limits (connections.ts). Both Hyperdrive origins come from its output, so
// neither config changes before it passes. The limits are part of the input,
// so changing them runs the check again. So is `output`: a stage's stored
// result from before the output named both origins is a bare origin, so
// bumping it runs the action once more and stores the current shape.

import type { PostgresOrigin } from "@alchemy.run/planetscale";
import { Action } from "alchemy";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import pg from "pg";

import { checkConnectionBudget } from "./connections.ts";
import type { ConnectionLimits } from "./connections.ts";

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
const grant = async (
  admin: PostgresOrigin,
  app: PostgresOrigin,
  connectionLimits: ConnectionLimits,
) => {
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
    const { rows: settings } = await client.query<{
      max: number;
      reserved: number;
    }>(
      "select current_setting('max_connections')::int as max, current_setting('superuser_reserved_connections')::int + coalesce(current_setting('reserved_connections', true)::int, 0) as reserved",
    );
    console.log(JSON.stringify({ connections: settings[0] }));
    checkConnectionBudget(
      { maxConnections: settings[0]!.max, reserved: settings[0]!.reserved },
      connectionLimits,
    );
  });
};

export const GrantAppRole = Action(
  "Preprocess.GrantAppRole",
  (input: {
    admin: PostgresOrigin;
    app: PostgresOrigin;
    connectionLimits: ConnectionLimits;
    output: 2;
  }) =>
    Effect.tryPromise({
      try: () => grant(input.admin, input.app, input.connectionLimits),
      catch: (error) =>
        new GrantFailed({
          message: `Granting preprocess_app failed: ${error instanceof Error ? error.message : String(error)}`,
        }),
    }).pipe(Effect.as({ app: input.app, system: input.admin })),
);
