"use client";

import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ClientApiError, clientGraphql } from "./graphql";
import { issueClientApiToken } from "./issue-client-api-token";
import type { ClientApiSession, ClientOrganization } from "./types";

type ClientApiSessionContextValue = {
  session: ClientApiSession | null;
  organizations: ClientOrganization[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<ClientApiSession | null>;
  /** The current Widgets API token, read at request time. */
  getToken: () => string | null;
  updateOrganizationName: (id: string, name: string) => void;
  graphql: <T>(
    query: string,
    variables?: Record<string, unknown>,
  ) => Promise<T>;
};

const ORGANIZATIONS_QUERY = /* GraphQL */ `
  query Organizations {
    organizations {
      id
      name
      isCurrent
    }
  }
`;

const ClientApiSessionContext =
  createContext<ClientApiSessionContextValue | null>(null);

export function ClientApiSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user, organizationId, loading: authLoading } = useAuth();
  const issueToken = useServerFn(issueClientApiToken);
  const [session, setSession] = useState<ClientApiSession | null>(null);
  const [organizations, setOrganizations] = useState<ClientOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<ClientApiSession | null>(null);

  const refresh = useCallback(async () => {
    if (!user || !organizationId) {
      sessionRef.current = null;
      setSession(null);
      setOrganizations([]);
      setError(null);
      setLoading(false);
      return null;
    }

    setLoading(true);
    try {
      const issued = await issueToken();
      sessionRef.current = issued;
      setSession(issued);
      setError(null);

      try {
        const data = await clientGraphql<{
          organizations: ClientOrganization[];
        }>(issued.token, ORGANIZATIONS_QUERY);
        setOrganizations(data.organizations);
      } catch {
        setOrganizations([]);
      }

      return issued;
    } catch (cause) {
      sessionRef.current = null;
      setSession(null);
      setOrganizations([]);
      setError(
        cause instanceof Error ? cause.message : "Could not open settings.",
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [issueToken, organizationId, user]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [authLoading, refresh]);

  const graphql = useCallback(
    async <T,>(query: string, variables: Record<string, unknown> = {}) => {
      const current = sessionRef.current;
      if (!current) {
        throw new ClientApiError("Sign in to an organization to continue.");
      }

      try {
        return await clientGraphql<T>(current.token, query, variables);
      } catch (cause) {
        if (!(cause instanceof ClientApiError) || !cause.unauthorized) {
          throw cause;
        }
        const issued = await refresh();
        if (!issued) throw cause;
        return clientGraphql<T>(issued.token, query, variables);
      }
    },
    [refresh],
  );

  const getToken = useCallback(() => sessionRef.current?.token ?? null, []);

  const updateOrganizationName = useCallback((id: string, name: string) => {
    setOrganizations((current) =>
      current.map((organization) =>
        organization.id === id ? { ...organization, name } : organization,
      ),
    );
  }, []);

  const value: ClientApiSessionContextValue = {
    session,
    organizations,
    loading: authLoading || loading,
    error,
    refresh,
    getToken,
    updateOrganizationName,
    graphql,
  };

  return (
    <ClientApiSessionContext.Provider value={value}>
      {children}
    </ClientApiSessionContext.Provider>
  );
}

export function useClientApiSession(): ClientApiSessionContextValue {
  const context = useContext(ClientApiSessionContext);
  if (!context) {
    throw new Error(
      "useClientApiSession must be used within ClientApiSessionProvider",
    );
  }
  return context;
}

export function useOptionalClientApiSession(): ClientApiSessionContextValue | null {
  return useContext(ClientApiSessionContext);
}
