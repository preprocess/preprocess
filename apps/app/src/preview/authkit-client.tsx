/**
 * Preview stand-in for `@workos/authkit-tanstack-react-start/client`, aliased
 * only for `pnpm dev:preview` (see ./authkit.ts).
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {
  AuthContextType,
  AuthKitProviderProps,
} from "@workos/authkit-tanstack-react-start/client";

export type { AuthContextType, AuthKitProviderProps };

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthKitProvider({
  children,
  initialAuth,
}: {
  children: ReactNode;
  initialAuth?: AuthKitProviderProps["initialAuth"];
}) {
  const value = useMemo<AuthContextType>(() => {
    const auth = initialAuth?.user ? initialAuth : null;
    return {
      user: auth?.user ?? null,
      sessionId: auth?.sessionId,
      organizationId: auth?.organizationId,
      role: auth?.role,
      roles: auth?.roles,
      permissions: auth?.permissions,
      entitlements: auth?.entitlements,
      featureFlags: auth?.featureFlags,
      impersonator: auth?.impersonator,
      loading: false,
      getAuth: async () => {},
      refreshAuth: async () => {},
      signOut: () => {
        window.location.assign("/api/auth/sign-out");
        return Promise.resolve();
      },
      switchToOrganization: async () => {},
    };
  }, [initialAuth]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthKitProvider");
  return value;
}
