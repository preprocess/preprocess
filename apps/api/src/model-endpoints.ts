// Model endpoints an organization registers (design doc 10, section 4): an
// OpenAI-compatible URL that serves a catalogue model in place of its
// provider. The key is envelope-encrypted with the organization's data key
// (crypto.ts) and decrypted only here, for the runtime at case start and for
// an endpoint test; it is never returned by the API.

import { orgId, withOrg, type Tx } from "@preprocess/db/client";
import { modelEndpoints } from "@preprocess/db/schema/models";

import { decrypt, encrypt, orgKey, orgKeyVersion } from "./crypto.ts";
import type { Env } from "./env.ts";

export type ModelEndpointRow = typeof modelEndpoints.$inferSelect;

// What the runtime routes a model to: the endpoint's id for capture, and the
// route itself, which never leaves the runtime's memory.
export type RegisteredEndpoint = {
  id: string;
  url: string;
  key: string;
  model: string;
};

const aad = (organizationId: string, id: string) =>
  `${organizationId}|model_endpoint|${id}`;

export const sealKey = async (
  env: Env,
  tx: Tx,
  organizationId: string,
  id: string,
  key: string,
) => {
  const { version, key: dataKey } = await orgKey(env, tx, organizationId);
  return {
    keyVersion: version,
    keyCiphertext: await encrypt(dataKey, key, aad(organizationId, id)),
  };
};

export const openKey = async (
  env: Env,
  tx: Tx,
  row: Pick<
    ModelEndpointRow,
    "organizationId" | "id" | "keyVersion" | "keyCiphertext"
  >,
) => {
  if (row.keyVersion === null || row.keyCiphertext === null) return "";
  const dataKey = await orgKeyVersion(
    env,
    tx,
    row.organizationId,
    row.keyVersion,
  );
  return decrypt(dataKey, row.keyCiphertext, aad(row.organizationId, row.id));
};

// Every endpoint the organization registered, by model, for the runtime at
// case start (Platform.modelEndpoints).
export const registeredEndpoints = (env: Env, organizationId: string) =>
  withOrg(env, orgId(organizationId), async (tx) => {
    const out: Record<string, RegisteredEndpoint> = {};
    for (const row of await tx.select().from(modelEndpoints))
      out[row.model] = {
        id: row.id,
        url: row.url,
        key: await openKey(env, tx, row),
        model: row.providerModel,
      };
    return out;
  });

// The install's own MODEL_ENDPOINTS entries (spec 16), by model.
export const installEndpoints = (env: Env): Set<string> => {
  if (!env.MODEL_ENDPOINTS) return new Set();
  try {
    return new Set(
      Object.keys(JSON.parse(env.MODEL_ENDPOINTS) as Record<string, unknown>),
    );
  } catch {
    return new Set();
  }
};
