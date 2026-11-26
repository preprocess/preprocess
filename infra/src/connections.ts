// Hyperdrive keeps its own pool of origin connections for each config, up to
// that config's origin connection limit, which defaults to 60. Every
// PlanetScale branch we deploy to (production, staging, previews) allows 25
// connections and keeps 3 for superusers, so the two configs (DB and
// DB_SYSTEM) at the default could open far more than the server accepts.
// Once both pools warmed up, every new transaction failed with "remaining
// connection slots are reserved" (PRE-81). Together the two limits stay under
// the server's budget with room left for migrations, deploys and the
// PlanetScale console. Hyperdrive accepts nothing below 5, and treats the
// limit as soft, so the headroom also absorbs its brief overshoots.

export const originConnectionLimits = { app: 12, system: 6 } as const;

export const CONNECTION_HEADROOM = 4;

export type ConnectionLimits = { app: number; system: number };

export type ServerConnections = {
  maxConnections: number;
  // superuser_reserved_connections plus reserved_connections.
  reserved: number;
};

// Fails the deploy before any Hyperdrive config changes when the stage's
// server can't take both pools at their limits.
export const checkConnectionBudget = (
  server: ServerConnections,
  limits: ConnectionLimits = originConnectionLimits,
) => {
  const pools = limits.app + limits.system;
  const available =
    server.maxConnections - server.reserved - CONNECTION_HEADROOM;
  if (pools > available)
    throw new Error(
      `Hyperdrive may open ${pools} connections, but the database allows ${server.maxConnections} with ${server.reserved} reserved, leaving ${available} after ${CONNECTION_HEADROOM} of headroom. Lower originConnectionLimits in infra/src/connections.ts or raise the database's max_connections.`,
    );
};
