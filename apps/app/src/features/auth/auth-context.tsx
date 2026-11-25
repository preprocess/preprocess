"use client";

import { createContext, useContext, type ReactNode } from "react";

import { authPost } from "./client";
import type { Session } from "./session";

const AuthContext = createContext<Session | null>(null);

export function AuthProvider({
  session,
  children,
}: {
  session: Session | null;
  children: ReactNode;
}) {
  return (
    <AuthContext.Provider value={session}>{children}</AuthContext.Provider>
  );
}

async function signOut() {
  await authPost("/sign-out");
  window.location.assign("/sign-in");
}

async function switchToOrganization(organizationId: string) {
  await authPost("/organization/set-active", { organizationId });
}

export function useAuth() {
  const session = useContext(AuthContext);
  return {
    user: session?.user ?? null,
    organizationId: session?.organizationId ?? undefined,
    sessionId: session?.sessionId,
    signOut,
    switchToOrganization,
  };
}

/** The active organization's id; product routes always have one. */
export function useOrganizationId() {
  const { organizationId } = useAuth();
  if (!organizationId) throw new Error("No active organization.");
  return organizationId;
}
