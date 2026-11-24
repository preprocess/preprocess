// Envelope encryption for organization secrets and MCP connection tokens
// (design doc 01): AES-256-GCM, a per-organization data key wrapped by the
// master key, and additional data binding each ciphertext to its row. The
// runtime Worker has no master key binding, so it can decrypt nothing.

import type { Tx } from "@preprocess/db/client";
import { orgKeys } from "@preprocess/db/schema/secrets";
import { and, desc, eq, isNull } from "drizzle-orm";

import type { Env } from "./env.ts";

export const MASTER_KEY_ID = "secrets-master-v1";

const IV = 12;

const importKey = (raw: Uint8Array) =>
  crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

const seal = async (key: CryptoKey, plain: Uint8Array, aad: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
      key,
      plain,
    ),
  );
  const out = new Uint8Array(IV + sealed.length);
  out.set(iv);
  out.set(sealed, IV);
  return out;
};

const open = async (key: CryptoKey, box: Uint8Array, aad: string) =>
  new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: box.slice(0, IV),
        additionalData: new TextEncoder().encode(aad),
      },
      key,
      box.slice(IV),
    ),
  );

// Secrets Store on our cloud; a plain variable locally and in tests.
const masterKey = async (env: Env) => {
  const value =
    typeof env.SECRETS_MASTER_KEY === "string"
      ? env.SECRETS_MASTER_KEY
      : await env.SECRETS_MASTER_KEY.get();
  const raw = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("the master key must be 32 bytes");
  return importKey(raw);
};

// The organization's current data key, created on first use.
export const orgKey = async (env: Env, tx: Tx, organizationId: string) => {
  const kek = await masterKey(env);
  const [current] = await tx
    .select()
    .from(orgKeys)
    .where(
      and(
        eq(orgKeys.organizationId, organizationId),
        isNull(orgKeys.retiredAt),
      ),
    )
    .orderBy(desc(orgKeys.version))
    .limit(1);
  if (current) {
    const raw = await open(
      kek,
      current.wrappedKey,
      `${organizationId}|${current.version}`,
    );
    return { version: current.version, key: await importKey(raw) };
  }
  const raw = crypto.getRandomValues(new Uint8Array(32));
  await tx.insert(orgKeys).values({
    organizationId,
    version: 1,
    masterKeyId: MASTER_KEY_ID,
    wrappedKey: await seal(kek, raw, `${organizationId}|1`),
  });
  return { version: 1, key: await importKey(raw) };
};

export const orgKeyVersion = async (
  env: Env,
  tx: Tx,
  organizationId: string,
  version: number,
) => {
  const [row] = await tx
    .select()
    .from(orgKeys)
    .where(
      and(
        eq(orgKeys.organizationId, organizationId),
        eq(orgKeys.version, version),
      ),
    );
  if (!row) throw new Error(`organization key ${version} is missing`);
  const raw = await open(
    await masterKey(env),
    row.wrappedKey,
    `${organizationId}|${version}`,
  );
  return importKey(raw);
};

export const encrypt = async (key: CryptoKey, value: string, aad: string) =>
  seal(key, new TextEncoder().encode(value), aad);

export const decrypt = async (key: CryptoKey, box: Uint8Array, aad: string) =>
  new TextDecoder().decode(await open(key, box, aad));
