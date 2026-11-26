// The offline license key (spec 16). A key is base64url(payload) + "." +
// base64url(signature): Ed25519 over the exact payload bytes, which are JSON
// naming the signing key's id (kid), so keys can rotate. There is no license
// server; the key is checked on every entitlement read.

import { z } from "zod";

// Raw Ed25519 public keys, base64url, by kid. Only Preprocess, Inc. holds the
// private keys, which are secrets and never code.
export const licenseKeys: Record<string, string> = {
  // PLACEHOLDER: replace with the production signing key's public half before
  // the first license is issued. Its private half was thrown away, so nothing
  // verifies against it.
  "placeholder-2026": "GscneMHhWGSvdH1zphFxxo0nYfOJ_wKE9OIUqpIO6H0",
};

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

const verified = async (key: string, keys: Record<string, string>) => {
  const [payloadPart, signaturePart, ...rest] = key.trim().split(".");
  if (!payloadPart || !signaturePart || rest.length > 0) return null;
  const bytes = fromBase64url(payloadPart);
  const parsed = Payload.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
  if (!parsed.success) return null;
  const publicKey = keys[parsed.data.kid];
  if (!publicKey) return null;
  const imported = await crypto.subtle.importKey(
    "raw",
    fromBase64url(publicKey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    { name: "Ed25519" },
    imported,
    fromBase64url(signaturePart),
    bytes,
  );
  return ok ? parsed.data : null;
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
