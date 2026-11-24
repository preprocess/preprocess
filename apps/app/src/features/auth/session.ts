import { createServerFn } from "@tanstack/react-start";

import type { UserOrganization } from "../organizations/user-organization";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
};

export type Session = {
  sessionId: string;
  user: SessionUser;
  organizationId: string | null;
};

type BetterAuthSession = {
  session: { id: string; activeOrganizationId?: string | null };
  user: SessionUser;
} | null;

/** The signed-in person and their active organization, or null. */
export const loadSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<Session | null> => {
    const { apiJson } = await import("../../server/api.server");
    const body = await apiJson<BetterAuthSession>("/api/auth/get-session");
    if (!body) return null;
    const { id, name, email, emailVerified, image } = body.user;
    return {
      sessionId: body.session.id,
      user: { id, name, email, emailVerified, image: image ?? null },
      organizationId: body.session.activeOrganizationId ?? null,
    };
  },
);

export const loadOrganizations = createServerFn({ method: "GET" }).handler(
  async (): Promise<UserOrganization[]> => {
    const { apiJson } = await import("../../server/api.server");
    const organizations = await apiJson<{ id: string; name: string }[]>(
      "/api/auth/organization/list",
    );
    return organizations
      .map(({ id, name }) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  },
);

/** Makes an organization the session's active one. */
export const activateOrganization = createServerFn({ method: "POST" })
  .validator((input: { organizationId: string }) => input)
  .handler(async ({ data }) => {
    const { apiJson } = await import("../../server/api.server");
    await apiJson("/api/auth/organization/set-active", {
      method: "POST",
      body: JSON.stringify({ organizationId: data.organizationId }),
    });
    return { organizationId: data.organizationId };
  });

export type Invitation = {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  organizationName: string;
  inviterEmail: string;
  status: "pending" | "accepted" | "rejected" | "canceled";
  expiresAt: string;
};

/** An invitation addressed to the signed-in person, or why it can't be read. */
export const loadInvitation = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(
    async ({
      data: id,
    }): Promise<
      | { invitation: Invitation; problem: null }
      | { invitation: null; problem: string }
    > => {
      const { apiRequest } = await import("../../server/api.server");
      const response = await apiRequest(
        `/api/auth/organization/get-invitation?id=${encodeURIComponent(id)}`,
      );
      const body = await response.json<Invitation & { message?: string }>();
      if (!response.ok)
        return {
          invitation: null,
          problem: body.message ?? "This invitation can't be opened.",
        };
      return { invitation: body, problem: null };
    },
  );
