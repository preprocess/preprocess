// The self-hosted install's license key (spec 16): its status for Owners and
// Admins, and an Owner uploading a new one. Only a key that verifies is
// stored, and the upload is audited with its customer and expiry, never the
// key. Our cloud has no license, so both routes answer 404 there.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg, withoutOrg } from "@preprocess/db/client";
import { installLicense } from "@preprocess/db/schema/license";
import { runMode } from "@preprocess/runmode";

import { eventBase, requireAdmin } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Env } from "../env.ts";
import { installKey, readLicense } from "../license.ts";
import { countSeats } from "../seats.ts";

const OrgParam = z.object({ org: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .openapi("Error");
const error = (description: string) => json(ErrorBody, description);

const LicenseStatus = z
  .object({
    status: z.enum(["none", "invalid", "active", "grace", "expired"]).openapi({
      description:
        "grace: expired, paid features on until graceEndsAt; expired: past grace, paid features off; invalid: the key does not verify",
    }),
    source: z.enum(["upload", "environment"]).nullable().openapi({
      description:
        "Where the key comes from: uploaded by an Owner, or PREPROCESS_LICENSE_KEY",
    }),
    uploadedAt: z.string().nullable(),
    customer: z.string().nullable(),
    seats: z.object({ used: z.number(), limit: z.number().nullable() }),
    expiresAt: z.string().nullable(),
    graceEndsAt: z.string().nullable(),
  })
  .openapi("License");

const LicenseUpload = z
  .object({ key: z.string().trim().min(1, "Paste a license key.") })
  .strict()
  .openapi("LicenseUpload");

const notHere = () =>
  new ApiError(404, "not_found", "Licenses are for self-hosted installs.");

export const licenseRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>({
  defaultHook: (result, c) => {
    if (!result.success)
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: result.error.issues.map((i) => i.message).join("; "),
          },
        },
        400,
      );
  },
})
  .openapi(
    createRoute({
      method: "get",
      path: "/license",
      tags: ["Organization"],
      summary: "The self-hosted install's license (Owners and Admins)",
      request: { params: OrgParam },
      responses: {
        200: json(LicenseStatus, "The license and its seat use"),
        403: error("Members can't see the license"),
        404: error("Not a self-hosted install"),
      },
    }),
    async (c) => {
      if (runMode(c.env).kind === "cloud") throw notHere();
      requireAdmin(c.var.caller);
      const installed = await installKey(c.env);
      const state = await readLicense(installed?.key);
      const used = await withOrg(c.env, c.var.org, countSeats);
      const license = "license" in state ? state.license : null;
      return c.json(
        {
          status: state.status,
          source: installed?.source ?? null,
          uploadedAt: installed?.uploadedAt?.toISOString() ?? null,
          customer: license?.customer ?? null,
          seats: { used, limit: license?.seats ?? null },
          expiresAt: license?.expiresAt.toISOString() ?? null,
          graceEndsAt: license?.graceEndsAt.toISOString() ?? null,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/license",
      tags: ["Organization"],
      summary: "Upload the install's license key (Owner)",
      description:
        "Replaces the install's key, which then takes precedence over PREPROCESS_LICENSE_KEY. A key that doesn't verify or is past its grace period is refused and not stored. Audited as license.uploaded with the customer and expiry.",
      request: {
        params: OrgParam,
        body: {
          content: { "application/json": { schema: LicenseUpload } },
          required: true,
        },
      },
      responses: {
        204: { description: "Stored" },
        400: error("The key doesn't verify or is past its grace period"),
        403: error("Only Owners upload a license key"),
        404: error("Not a self-hosted install"),
      },
    }),
    async (c) => {
      if (runMode(c.env).kind === "cloud") throw notHere();
      const caller = c.var.caller;
      if (caller.type !== "person" || caller.role !== "owner")
        throw new ApiError(
          403,
          "forbidden",
          "Only Owners can upload a license key.",
        );
      const { key } = c.req.valid("json");
      const state = await readLicense(key);
      if (state.status === "none" || state.status === "invalid")
        throw new ApiError(
          400,
          "invalid_license",
          "This license key isn't valid. Check that you pasted the whole key.",
        );
      if (state.status === "expired")
        throw new ApiError(
          400,
          "license_expired",
          "This license key has expired. Ask Preprocess for a renewed key.",
        );
      const { license } = state;
      await withoutOrg(c.env, "license: upload install key", (tx) =>
        tx
          .insert(installLicense)
          .values({ key, uploadedBy: caller.userId })
          .onConflictDoUpdate({
            target: installLicense.id,
            set: { key, uploadedBy: caller.userId, uploadedAt: new Date() },
          }),
      );
      await withOrg(c.env, c.var.org, (tx) =>
        audit(tx, {
          ...eventBase(c.var),
          action: "license.uploaded",
          targetType: "license",
          data: {
            customer: license.customer,
            seats: license.seats,
            expiresAt: license.expiresAt.toISOString(),
          },
        }),
      );
      return c.body(null, 204);
    },
  );
