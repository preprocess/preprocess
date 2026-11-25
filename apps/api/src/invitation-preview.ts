// What a signed-out invitee sees before they sign in: the organization, who
// invited them and the address it went to. The invitation id is the secret
// the email carried, so holding it is enough to read this much and no more.

import { withoutOrg } from "@preprocess/db/client";
import { invitation, organization, user } from "@preprocess/db/schema/auth";
import { eq } from "drizzle-orm";

import type { Env } from "./env.ts";

export type InvitationPreview = {
  email: string;
  organizationName: string;
  inviterName: string;
  status: string;
  expiresAt: string;
};

export const invitationPreview = (env: Env, id: string) =>
  withoutOrg(env, "invitation preview for a signed-out invitee", async (tx) => {
    const [found] = await tx
      .select({
        email: invitation.email,
        organizationName: organization.name,
        inviterName: user.name,
        inviterEmail: user.email,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      })
      .from(invitation)
      .innerJoin(organization, eq(organization.id, invitation.organizationId))
      .innerJoin(user, eq(user.id, invitation.inviterId))
      .where(eq(invitation.id, id))
      .limit(1);
    if (!found) return null;
    const preview: InvitationPreview = {
      email: found.email,
      organizationName: found.organizationName,
      inviterName: found.inviterName || found.inviterEmail,
      status:
        found.status === "pending" && found.expiresAt < new Date()
          ? "expired"
          : found.status,
      expiresAt: found.expiresAt.toISOString(),
    };
    return preview;
  });
