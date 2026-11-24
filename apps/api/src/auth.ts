// Better Auth, run in our own code (spec 13): email and password, the
// organization plugin with the fixed roles, and organization-wide API keys.
//
// Every auth request runs inside one Postgres transaction on DB_SYSTEM: the
// Drizzle adapter writes through that transaction, and the hooks below write
// their audit events and Developers group through the same one, so an action
// and its audit event commit together or not at all (doc 02). A response with
// an error status rolls the transaction back.

import { apiKey } from "@better-auth/api-key";
import { audit, startAuditChain } from "@preprocess/db/audit";
import type { AuditInput } from "@preprocess/db/audit";
import { withoutOrg } from "@preprocess/db/client";
import type { SystemTx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import type { IdKind } from "@preprocess/db/ids";
import { groups } from "@preprocess/db/schema/access";
import * as authSchema from "@preprocess/db/schema/auth";
import { runMode } from "@preprocess/runmode";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import { and, count, eq, gt, sql } from "drizzle-orm";

import { sendInvitationEmail, sendVerificationEmail } from "./email.ts";
import type { Env } from "./env.ts";

// Owner, Admin and Member are Better Auth's own roles. The only addition is
// that Admins manage organization API keys (mvp-surface), which by default
// only the owner may.
const ac = createAccessControl({
  ...defaultStatements,
  apiKey: ["create", "read", "update", "delete"],
});
const all = ["create", "read", "update", "delete"] as const;
const roles = {
  owner: ac.newRole({ ...ownerAc.statements, apiKey: [...all] }),
  admin: ac.newRole({ ...adminAc.statements, apiKey: [...all] }),
  member: ac.newRole({ ...memberAc.statements }),
};

const idKinds: Record<string, IdKind> = {
  user: "user",
  session: "session",
  account: "account",
  verification: "verification",
  organization: "organization",
  member: "member",
  invitation: "invitation",
  apikey: "apikey",
};

// Who is acting and from where, for the audit events this request writes.
export type RequestContext = {
  ip: string | null;
  requestId: string;
  // The signed-in person, looked up before the handler runs; null on sign-up
  // and sign-in.
  actorId: string | null;
};

export const requestContext = (request: Request): RequestContext => ({
  ip: request.headers.get("cf-connecting-ip"),
  requestId: request.headers.get("cf-ray") ?? crypto.randomUUID(),
  actorId: null,
});

export const createAuth = (env: Env, tx: SystemTx, request: RequestContext) => {
  const record = (event: Omit<AuditInput, "ip" | "requestId">) =>
    audit(tx, { ...event, ip: request.ip, requestId: request.requestId });
  // Better Auth adds the creator as owner (calling afterAddMember) before
  // afterCreateOrganization, when the chain does not exist yet. The
  // organization.created event records that owner instead.
  let creatingOrganization = false;
  const person = (fallback: string) => request.actorId ?? fallback;

  return betterAuth({
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(tx, { provider: "pg", schema: authSchema }),
    emailAndPassword: { enabled: true },
    // Accepting an invitation needs a verified email (Better Auth's default),
    // so nobody can sign up with someone else's address and take their seat.
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        await sendVerificationEmail(env, { email: user.email, url });
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      database: {
        generateId: ({ model }) => newId(idKinds[model] ?? "verification"),
      },
    },
    user: {
      additionalFields: {
        deactivatedAt: { type: "date", required: false, input: false },
        // Set by the person through update-user (design doc 06).
        emailNotifications: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: true,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Sign-up is open on our cloud. A self-hosted install takes its
          // first person, then only people with a pending invitation.
          async before(user) {
            if (runMode(env).kind === "cloud") return;
            const [{ users = 0 } = {}] = await tx
              .select({ users: count() })
              .from(authSchema.user);
            if (users === 0) return;
            const [invited] = await tx
              .select({ id: authSchema.invitation.id })
              .from(authSchema.invitation)
              .where(
                and(
                  sql`lower(${authSchema.invitation.email}) = lower(${user.email})`,
                  eq(authSchema.invitation.status, "pending"),
                  gt(authSchema.invitation.expiresAt, new Date()),
                ),
              )
              .limit(1);
            if (!invited)
              throw new APIError("FORBIDDEN", {
                message: "Sign-up on this install needs an invitation.",
              });
          },
        },
      },
      session: {
        create: {
          // A deactivated person cannot start a session by any sign-in method
          // (PLAT-27: Better Auth only deletes their sessions).
          async before(session) {
            const [found] = await tx
              .select({ deactivatedAt: authSchema.user.deactivatedAt })
              .from(authSchema.user)
              .where(eq(authSchema.user.id, session.userId));
            if (found?.deactivatedAt)
              throw new APIError("FORBIDDEN", {
                message: "This account is deactivated.",
              });
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned as
          | { id?: string; referenceId?: string; name?: string | null }
          | undefined;
        if (!returned || returned instanceof Response || !request.actorId)
          return;
        if (ctx.path === "/api-key/create" && returned.referenceId)
          await record({
            organizationId: returned.referenceId,
            actorType: "person",
            actorId: request.actorId,
            action: "api_key.created",
            targetType: "api_key",
            targetId: returned.id ?? null,
            data: { name: returned.name ?? null },
          });
      }),
    },
    plugins: [
      organization({
        ac,
        roles,
        invitationExpiresIn: 7 * 24 * 60 * 60,
        cancelPendingInvitationsOnReInvite: true,
        schema: {
          organization: {
            additionalFields: {
              createdBy: { type: "string", required: false, input: false },
            },
          },
        },
        async sendInvitationEmail(data) {
          await sendInvitationEmail(env, {
            id: data.id,
            email: data.email,
            organizationName: data.organization.name,
            inviterName: data.inviter.user.name,
          });
        },
        organizationHooks: {
          beforeCreateOrganization: ({ organization: org, user }) => {
            creatingOrganization = true;
            return Promise.resolve({ data: { ...org, createdBy: user.id } });
          },
          async afterCreateOrganization({ organization: org, user }) {
            await startAuditChain(tx, org.id);
            const developers = newId("group");
            await tx.insert(groups).values({
              id: developers,
              organizationId: org.id,
              slug: "developers",
              name: "Developers",
              description: "Manages every agent.",
              isDevelopers: true,
            });
            await record({
              organizationId: org.id,
              actorType: "person",
              actorId: user.id,
              action: "organization.created",
              targetType: "organization",
              targetId: org.id,
              data: {
                name: org.name,
                slug: org.slug,
                owner: user.id,
                developersGroup: developers,
              },
            });
          },
          async afterUpdateOrganization({ organization: org, user }) {
            if (!org) return;
            await record({
              organizationId: org.id,
              actorType: "person",
              actorId: user.id,
              action: "organization.updated",
              targetType: "organization",
              targetId: org.id,
              data: { name: org.name, slug: org.slug },
            });
          },
          async beforeDeleteOrganization({ organization: org, user }) {
            await record({
              organizationId: org.id,
              actorType: "person",
              actorId: user.id,
              action: "organization.deleted",
              targetType: "organization",
              targetId: org.id,
            });
            await tx.execute(sql`
              insert into deleted_organizations (organization_id, deleted_at, final_seq, final_hash)
              select organization_id, now(), seq, hash from audit_heads where organization_id = ${org.id}`);
          },
          async afterAcceptInvitation({ invitation, member, user }) {
            await record({
              organizationId: member.organizationId,
              actorType: "person",
              actorId: user.id,
              action: "member.added",
              targetType: "user",
              targetId: user.id,
              data: { role: member.role, invitation: invitation.id },
            });
          },
          async afterAddMember({ member, user }) {
            if (creatingOrganization) return;
            await record({
              organizationId: member.organizationId,
              actorType: request.actorId ? "person" : "platform",
              actorId: request.actorId ?? "platform:auth",
              action: "member.added",
              targetType: "user",
              targetId: user.id,
              data: { role: member.role },
            });
          },
          async afterUpdateMemberRole({ member, previousRole }) {
            await record({
              organizationId: member.organizationId,
              actorType: "person",
              actorId: person(member.userId),
              action: "member.role.changed",
              targetType: "user",
              targetId: member.userId,
              data: { from: previousRole, to: member.role },
            });
          },
          async afterRemoveMember({ member }) {
            await record({
              organizationId: member.organizationId,
              actorType: "person",
              actorId: person(member.userId),
              action: "member.removed",
              targetType: "user",
              targetId: member.userId,
            });
          },
          async afterCreateInvitation({ invitation, inviter }) {
            await record({
              organizationId: invitation.organizationId,
              actorType: "person",
              actorId: inviter.id,
              action: "invitation.created",
              targetType: "invitation",
              targetId: invitation.id,
              data: { role: invitation.role },
            });
          },
          async afterCancelInvitation({ invitation, cancelledBy }) {
            await record({
              organizationId: invitation.organizationId,
              actorType: "person",
              actorId: cancelledBy.id,
              action: "invitation.canceled",
              targetType: "invitation",
              targetId: invitation.id,
            });
          },
          async afterRejectInvitation({ invitation, user }) {
            await record({
              organizationId: invitation.organizationId,
              actorType: "person",
              actorId: user.id,
              action: "invitation.rejected",
              targetType: "invitation",
              targetId: invitation.id,
            });
          },
        },
      }),
      apiKey([
        {
          configId: "default",
          defaultPrefix: "pp_",
          references: "organization",
          enableMetadata: true,
          // The plugin's default is 10 requests per key per day, which a CLI
          // or integration exhausts in minutes.
          rateLimit: { enabled: false },
        },
      ]),
    ],
  });
};

export type Auth = ReturnType<typeof createAuth>;

class Rollback extends Error {
  constructor(readonly response: Response) {
    super("auth request failed");
  }
}

// Runs one Better Auth call in its own DB_SYSTEM transaction. `fn` returning
// an error Response, or throwing, rolls everything back.
export const withAuth = async <T>(
  env: Env,
  request: RequestContext,
  fn: (auth: Auth) => Promise<T>,
): Promise<T> => {
  try {
    return await withoutOrg(env, "better-auth", async (tx) => {
      const result = await fn(createAuth(env, tx, request));
      if (result instanceof Response && result.status >= 400)
        throw new Rollback(result);
      return result;
    });
  } catch (error) {
    if (error instanceof Rollback) return error.response as T;
    throw error;
  }
};

// Better Auth's own routes (/api/auth/*), with the signed-in person resolved
// first so hooks can name who acted.
export const handleAuthRequest = async (env: Env, request: Request) => {
  const context = requestContext(request);
  return withAuth(env, context, async (auth) => {
    const session = await auth.api.getSession({ headers: request.headers });
    context.actorId = session?.user.id ?? null;
    return auth.handler(request);
  });
};
