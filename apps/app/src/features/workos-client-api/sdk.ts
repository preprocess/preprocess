import {
  useMutation,
  useQuery,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { ClientError, GraphQLClient } from "graphql-request";
import { useMemo } from "react";

import { useClientApiSession } from "./client-api-session";
import { CLIENT_GRAPHQL_URL, ClientApiError } from "./graphql";
import { getSdk, type Sdk } from "./vendor/generated";

export type { Sdk };
export type WorkOsOperation = keyof Sdk;

// The Client API answers permission and auth failures as HTTP 200 with an
// UNAUTHENTICATED or FORBIDDEN error code; 401/403 only come from proxies.
function isAuthError(error: ClientError) {
  const { status, errors } = error.response;
  if (status === 401 || status === 403) return true;
  return (errors ?? []).some((entry) => {
    const code = entry.extensions?.code;
    return code === "UNAUTHENTICATED" || code === "FORBIDDEN";
  });
}

function toClientApiError(error: unknown): unknown {
  if (!(error instanceof ClientError)) return error;
  const errors = error.response.errors ?? [];
  const codes = errors
    .map((entry) => entry.extensions?.code)
    .filter((code): code is string => typeof code === "string");
  const unauthenticated = codes.includes("UNAUTHENTICATED");
  return new ClientApiError(errors[0]?.message ?? error.message, {
    status: unauthenticated ? 401 : error.response.status,
    codes: codes.map((code) => (code === "FORBIDDEN" ? "Forbidden" : code)),
  });
}

/**
 * The WorkOS Client GraphQL API as a typed SDK (vendored from
 * @workos-inc/widgets). Requests carry the session's Widgets API token; an
 * auth failure re-issues the token once and retries.
 */
export function useWorkOsSdk(): Sdk {
  const { getToken, refresh } = useClientApiSession();

  return useMemo(() => {
    const client = new GraphQLClient(CLIENT_GRAPHQL_URL);
    return getSdk(client, async (action) => {
      const token = getToken();
      if (!token) {
        throw new ClientApiError("Sign in to an organization to continue.");
      }
      try {
        return await action({ Authorization: `Bearer ${token}` });
      } catch (error) {
        if (!(error instanceof ClientError) || !isAuthError(error)) {
          throw toClientApiError(error);
        }
        const issued = await refresh();
        if (!issued || issued.token === token) throw toClientApiError(error);
        try {
          return await action({ Authorization: `Bearer ${issued.token}` });
        } catch (retryError) {
          throw toClientApiError(retryError);
        }
      }
    });
  }, [getToken, refresh]);
}

const KEY_PREFIX = "workos";

/** Query key for an operation; omit `variables` to match every variant. */
export function workOsKey<K extends WorkOsOperation>(
  operation: K,
  variables?: Parameters<Sdk[K]>[0],
): QueryKey {
  return variables === undefined
    ? [KEY_PREFIX, operation]
    : [KEY_PREFIX, operation, variables];
}

export function useWorkOsQuery<TResult, TData = TResult>({
  queryFn,
  enabled = true,
  ...options
}: Omit<UseQueryOptions<TResult, Error, TData>, "queryFn"> & {
  queryFn: (sdk: Sdk) => Promise<TResult>;
}) {
  const sdk = useWorkOsSdk();
  const { session } = useClientApiSession();
  return useQuery<TResult, Error, TData>({
    ...options,
    queryFn: () => queryFn(sdk),
    enabled: Boolean(session) && enabled,
  });
}

export function useWorkOsMutation<TResult, TVariables = void>({
  mutationFn,
  ...options
}: Omit<UseMutationOptions<TResult, Error, TVariables>, "mutationFn"> & {
  mutationFn: (sdk: Sdk, variables: TVariables) => Promise<TResult>;
}) {
  const sdk = useWorkOsSdk();
  return useMutation<TResult, Error, TVariables>({
    ...options,
    mutationFn: (variables) => mutationFn(sdk, variables),
  });
}
