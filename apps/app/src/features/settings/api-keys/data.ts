// Data for the API keys panel, ported from the WorkOS api-keys and
// user-api-keys widgets (@workos-inc/widgets). Both scopes share one shape;
// user keys also carry their owner ("Created by").

import { keepPreviousData, useQueryClient } from "@tanstack/react-query";

import { ClientApiError } from "../../workos-client-api/graphql";
import {
  useWorkOsMutation,
  useWorkOsQuery,
  workOsKey,
  type Sdk,
} from "../../workos-client-api/sdk";
import { expectResultMember } from "../../workos-client-api/vendor/client-graphql-result";
import type {
  ListOrganizationApiKeysQueryVariables,
  ListUserApiKeysQuery,
} from "../../workos-client-api/vendor/generated";

export type ApiKeyScope = "user" | "organization";

export type ApiKey = {
  id: string;
  name: string;
  obfuscatedValue: string;
  permissions: string[];
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  owner?: ListUserApiKeysQuery["userApiKeys"]["data"][number]["owner"];
};

export type ApiKeyPage = {
  data: ApiKey[];
  listMetadata: { after?: string | null; before?: string | null };
};

export type ApiKeyPermission = {
  slug: string;
  name: string;
  description?: string | null;
};

export type ApiKeyListParams = Pick<
  ListOrganizationApiKeysQueryVariables,
  "after" | "before" | "search"
>;

const LIST_OPERATION = {
  user: "ListUserApiKeys",
  organization: "ListOrganizationApiKeys",
} as const;

function listKey(scope: ApiKeyScope, params?: ApiKeyListParams) {
  return scope === "user"
    ? workOsKey("ListUserApiKeys", params)
    : workOsKey("ListOrganizationApiKeys", params);
}

async function listApiKeys(
  sdk: Sdk,
  scope: ApiKeyScope,
  params: ApiKeyListParams,
): Promise<ApiKeyPage> {
  const variables = { ...params, search: params.search || undefined };
  if (scope === "user") {
    return (await sdk.ListUserApiKeys(variables)).userApiKeys;
  }
  return (await sdk.ListOrganizationApiKeys(variables)).organizationApiKeys;
}

export function useApiKeys(scope: ApiKeyScope, params: ApiKeyListParams) {
  return useWorkOsQuery({
    queryKey: listKey(scope, params),
    queryFn: (sdk) => listApiKeys(sdk, scope, params),
    placeholderData: keepPreviousData,
  });
}

/** Permissions a key of this scope can be granted (the widgets ask for 100). */
export function useApiKeyPermissions(scope: ApiKeyScope) {
  const apiKeyOwnerType = scope === "user" ? "User" : "Organization";
  return useWorkOsQuery({
    queryKey: workOsKey("ListApiKeyPermissions", {
      apiKeyOwnerType,
      limit: 100,
    }),
    queryFn: async (sdk): Promise<ApiKeyPermission[]> =>
      (await sdk.ListApiKeyPermissions({ apiKeyOwnerType, limit: 100 }))
        .permissions.data,
  });
}

function useInvalidateApiKeys(scope: ApiKeyScope) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: workOsKey(LIST_OPERATION[scope]),
    });
}

// Create failures carry their own message (invalid name, permissions not
// held…); keep it so the dialog can show what to fix.
function createdOrThrow<
  T extends { __typename: string; message?: string },
  N extends T["__typename"],
>(result: T, typename: N): Extract<T, { __typename: N }> {
  if (result.__typename === typename) {
    return result as Extract<T, { __typename: N }>;
  }
  throw new ClientApiError(
    result.message ?? "An error occurred while creating the API key.",
    { codes: [result.__typename] },
  );
}

export type CreateApiKeyInput = {
  name: string;
  permissions: string[];
  expiresAt: string | null;
};

export function useCreateApiKey(scope: ApiKeyScope) {
  const invalidate = useInvalidateApiKeys(scope);
  return useWorkOsMutation({
    mutationFn: async (sdk, input: CreateApiKeyInput) => {
      const payload = {
        name: input.name,
        permissions: input.permissions,
        expiresAt: input.expiresAt ?? undefined,
      };
      if (scope === "user") {
        const data = await sdk.CreateUserApiKey({ input: payload });
        return createdOrThrow(data.createUserApiKey, "UserApiKeyCreated").value;
      }
      const data = await sdk.CreateOrganizationApiKey({ input: payload });
      return createdOrThrow(
        data.createOrganizationApiKey,
        "OrganizationApiKeyCreated",
      ).value;
    },
    onSuccess: () => invalidate(),
  });
}

/** Sets a key's expiration: a future date schedules it, null clears it. */
export function useEditApiKeyExpiration(scope: ApiKeyScope) {
  const invalidate = useInvalidateApiKeys(scope);
  return useWorkOsMutation({
    mutationFn: async (
      sdk,
      input: { apiKeyId: string; expiresAt: string | null },
    ) => {
      if (scope === "user") {
        const data = await sdk.ExpireUserApiKey({ input });
        return expectResultMember(data.expireUserApiKey, "UserApiKeyExpired");
      }
      const data = await sdk.ExpireOrganizationApiKey({ input });
      return expectResultMember(
        data.expireOrganizationApiKey,
        "OrganizationApiKeyExpired",
      );
    },
    onSuccess: () => invalidate(),
  });
}

/** Revokes a key for good (the widgets' "Revoke key"). */
export function useRevokeApiKey(scope: ApiKeyScope) {
  const invalidate = useInvalidateApiKeys(scope);
  return useWorkOsMutation({
    mutationFn: async (sdk, apiKeyId: string) => {
      if (scope === "user") {
        await sdk.DeleteUserApiKey({ apiKeyId });
        return;
      }
      await sdk.DeleteOrganizationApiKey({ apiKeyId });
    },
    onSuccess: () => invalidate(),
  });
}

/** "Oct 24, 2026, 3:15 PM", or "Never" without a date. */
export function formatExpiresAt(expiresAt?: string | null) {
  if (!expiresAt) return "Never";
  return formatTimestamp(expiresAt);
}

export function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The widgets' "Created by": display name, then full name, then email. */
export function apiKeyCreatedBy(apiKey: ApiKey) {
  const owner = apiKey.owner;
  if (!owner) return "-";
  if (owner.displayName) return owner.displayName;
  const fullName = [owner.firstName, owner.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || owner.email || "-";
}
