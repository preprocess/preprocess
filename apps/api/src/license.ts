// The offline license key (spec 16). A key is base64url(payload) + "." +
// base64url(signature): Ed25519 over the exact payload bytes. The payload
// names the signing key's id (kid), for the issuer's records only. There is
// no license server; the key is checked on every entitlement read.

import { withoutOrgRead } from "@preprocess/db/client";
import { installLicense } from "@preprocess/db/schema/license";
import { z } from "zod";

import type { Env } from "./env.ts";

// PLACEHOLDER, NOT A REAL SIGNING KEY. Its private half was thrown away, so
// no license verifies against it. Replace it with the production key's public
// half (preprocess/internal docs/licence-signing.md) before the first license
// is issued.
export const PLACEHOLDER_LICENSE_KEY =
  "GscneMHhWGSvdH1zphFxxo0nYfOJ_wKE9OIUqpIO6H0";

// Raw Ed25519 public keys, base64url. A license verifies if any of them signed
// it, so rotating adds the new key and removes the old one only once no
// license needs it. Only Preprocess, Inc. holds the private keys, which are
// secrets and never code.
export const licenseKeys: string[] = [PLACEHOLDER_LICENSE_KEY];

export const GRACE_DAYS = 30;
const day = 24 * 60 * 60 * 1000;

const Payload = z.object({
  kid: z.string(),
  customer: z.string().min(1),
  features: z.array(z.string()),
  seats: z.number().int().positive(),
  issuedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
});

export type License = {
  kid: string;
  customer: string;
  // As signed; plan.ts ignores names this build doesn't know.
  features: string[];
  seats: number;
  issuedAt: Date;
  expiresAt: Date;
  graceEndsAt: Date;
};

// active until expiresAt, grace for 30 days after it, then expired.
export type LicenseState =
  | { status: "none" }
  | { status: "invalid" }
  | { status: "active" | "grace" | "expired"; license: License };

const fromBase64url = (text: string) => {
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

const signedBy = async (
  publicKey: string,
  signature: Uint8Array,
  bytes: Uint8Array,
) => {
  const imported = await crypto.subtle.importKey(
    "raw",
    fromBase64url(publicKey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify({ name: "Ed25519" }, imported, signature, bytes);
};

const verified = async (key: string, keys: readonly string[]) => {
  const [payloadPart, signaturePart, ...rest] = key.trim().split(".");
  if (!payloadPart || !signaturePart || rest.length > 0) return null;
  const bytes = fromBase64url(payloadPart);
  const parsed = Payload.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
  if (!parsed.success) return null;
  const signature = fromBase64url(signaturePart);
  for (const publicKey of keys)
    if (await signedBy(publicKey, signature, bytes)) return parsed.data;
  return null;
};

// The install's key: the one an Owner uploaded, else PREPROCESS_LICENSE_KEY.
export const installKey = async (
  env: Env,
): Promise<{
  key: string;
  source: "upload" | "environment";
  uploadedAt: Date | null;
} | null> => {
  const [uploaded] = await withoutOrgRead(env, "license: install key", (tx) =>
    tx
      .select({
        key: installLicense.key,
        uploadedAt: installLicense.uploadedAt,
      })
      .from(installLicense),
  );
  if (uploaded) return { ...uploaded, source: "upload" };
  if (env.PREPROCESS_LICENSE_KEY?.trim())
    return {
      key: env.PREPROCESS_LICENSE_KEY,
      source: "environment",
      uploadedAt: null,
    };
  return null;
};

export const readLicense = async (
  key: string | undefined,
  now = new Date(),
  keys = licenseKeys,
): Promise<LicenseState> => {
  if (!key?.trim()) return { status: "none" };
  const payload = await verified(key, keys).catch(() => null);
  if (!payload) return { status: "invalid" };
  const expiresAt = new Date(payload.expiresAt);
  const license: License = {
    kid: payload.kid,
    customer: payload.customer,
    features: payload.features,
    seats: payload.seats,
    issuedAt: new Date(payload.issuedAt),
    expiresAt,
    graceEndsAt: new Date(expiresAt.getTime() + GRACE_DAYS * day),
  };
  const status =
    now < license.expiresAt
      ? "active"
      : now < license.graceEndsAt
        ? "grace"
        : "expired";
  return { status, license };
};
