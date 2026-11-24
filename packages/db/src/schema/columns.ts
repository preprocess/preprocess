import { customType } from "drizzle-orm/pg-core";

// Drizzle has no built-in bytea column. pg sends typed arrays as bytea and
// returns a Buffer, which is a Uint8Array; copy it so callers get a plain one.
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => new Uint8Array(value),
});
