// The OAuth hand-off for connecting a data provider. Ported from
// @workos-inc/widgets (MIT, Copyright (c) 2024 WorkOS),
// src/widgets/pipes/pipes.tsx (useOpenDataIntegrationAuthorizeUrl).

import { useCallback, useEffect, useRef, useState } from "react";

import { ClientApiError } from "../../workos-client-api/graphql";
import {
  useWorkOsQuery,
  useWorkOsSdk,
  workOsKey,
} from "../../workos-client-api/sdk";
import type {
  CreateDataProviderAuthorizationMutation,
  CreateOrganizationDataProviderAuthorizationMutation,
} from "../../workos-client-api/vendor/generated";
import {
  configEntries,
  displayNameInput,
  targetInput,
  type ConnectionOwner,
  type ConnectionTarget,
} from "./model";

const HANDOFF_INTERVAL_MS = 100;
const HANDOFF_MAX_ATTEMPTS = 100; // 10 seconds of attempts

type AuthorizationResult =
  | CreateDataProviderAuthorizationMutation["createDataProviderAuthorization"]
  | CreateOrganizationDataProviderAuthorizationMutation["createOrganizationDataProviderAuthorization"];

type Authorization = Extract<
  AuthorizationResult,
  { __typename: "DataProviderAuthorization" }
>;

function unwrapAuthorization(result: AuthorizationResult): Authorization {
  switch (result.__typename) {
    case "DataProviderAuthorization":
      return result;
    case "DataProviderConfigInvalid":
    case "DataProviderAuthorizationUnavailable":
      throw new ClientApiError(result.message, { codes: [result.__typename] });
  }
}

/** Starts an OAuth authorization with the config and name a dialog collected. */
export type ConnectHandler = (
  config?: Record<string, string>,
  accountDisplayName?: string,
) => Promise<void>;

export type ConnectionError = {
  errorCode?: string;
  errorDescription?: string;
};

function useAuthKitOrigin(): string {
  const settings = useWorkOsQuery({
    queryKey: workOsKey("AuthKitSettings"),
    queryFn: (sdk) => sdk.AuthKitSettings(),
  });
  return settings.data?.authkitSettings.origin ?? "";
}

/**
 * Runs the OAuth hand-off for one connection target and tracks how it ended,
 * so the row that owns it can show "Connection failed". The popup is opened
 * synchronously (before any await) so popup blockers allow it.
 */
export function useOpenAuthorizeUrl(
  dataProviderId: string,
  owner: ConnectionOwner = "user",
  target?: ConnectionTarget,
) {
  const sdk = useWorkOsSdk();
  const origin = useAuthKitOrigin();
  // Keyed by value so a target rebuilt each render keeps the callback stable.
  const targetIntent = target?.intent;
  const targetAccountId =
    target?.intent === "Reauthorize" ? target.connectedAccountId : undefined;
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | undefined>(
    undefined,
  );
  // Whether the popup sent any message before it closed.
  const receivedMessageRef = useRef(false);
  const [connectionError, setConnectionError] =
    useState<ConnectionError | null>(null);

  const stopHandoff = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
    if (messageHandlerRef.current) {
      window.removeEventListener("message", messageHandlerRef.current);
      messageHandlerRef.current = undefined;
    }
  }, []);

  useEffect(() => stopHandoff, [stopHandoff]);

  // Also abandons a pending attempt, so a popup left open while another
  // method connects can't report a failure afterwards.
  const clearConnectionError = useCallback(() => {
    stopHandoff();
    setConnectionError(null);
  }, [stopHandoff]);

  const authorize = useCallback(
    async (config?: Record<string, string>, accountDisplayName?: string) => {
      const resolvedTarget: ConnectionTarget | undefined =
        targetIntent === "Add"
          ? { intent: "Add" }
          : targetIntent === "Reauthorize" && targetAccountId
            ? { intent: "Reauthorize", connectedAccountId: targetAccountId }
            : undefined;
      const input = {
        dataProviderId,
        config: configEntries(config),
        ...targetInput(resolvedTarget),
        ...displayNameInput(accountDisplayName),
      };
      if (owner === "organization") {
        const { createOrganizationDataProviderAuthorization } =
          await sdk.CreateOrganizationDataProviderAuthorization({ input });
        return unwrapAuthorization(createOrganizationDataProviderAuthorization);
      }
      const { createDataProviderAuthorization } =
        await sdk.CreateDataProviderAuthorization({
          input: { ...input, requireHandoff: true },
        });
      return unwrapAuthorization(createDataProviderAuthorization);
    },
    [dataProviderId, owner, sdk, targetAccountId, targetIntent],
  );

  const openAuthorizeUrl: ConnectHandler = useCallback(
    async (config, accountDisplayName) => {
      stopHandoff();
      receivedMessageRef.current = false;
      setConnectionError(null);

      const popup = window.open(`${origin}/pipes/redirecting`, "_blank");
      if (!popup) {
        throw new Error("Unable to open the authorization window.");
      }

      let authorization: Authorization;
      try {
        authorization = await authorize(config, accountDisplayName);
      } catch (error) {
        popup.close();
        throw error;
      }

      const { url, handoffToken, redirectToken } = authorization;
      popup.location = url;
      const parsedUrl = new URL(url);
      const payload = {
        handoffToken: handoffToken ?? undefined,
        redirectToken,
      };

      messageHandlerRef.current = (event: MessageEvent) => {
        const data = event.data as
          | {
              redirectToken?: string;
              error?: boolean;
              errorCode?: string;
              errorDescription?: string;
            }
          | undefined;
        if (
          event.origin === parsedUrl.origin &&
          data?.redirectToken === redirectToken
        ) {
          receivedMessageRef.current = true;
          if (data.error === true) {
            setConnectionError({
              errorCode: data.errorCode,
              errorDescription: data.errorDescription,
            });
          }
          stopHandoff();
        }
      };
      window.addEventListener("message", messageHandlerRef.current);

      let attempts = 0;
      intervalRef.current = setInterval(() => {
        attempts += 1;
        if (attempts >= HANDOFF_MAX_ATTEMPTS) {
          stopHandoff();
          return;
        }
        if (!popup.closed) {
          popup.postMessage(payload, parsedUrl.origin);
        } else {
          // Closed without a result: report a generic failure.
          if (!receivedMessageRef.current) {
            setConnectionError({ errorCode: "connection_failed" });
          }
          stopHandoff();
        }
      }, HANDOFF_INTERVAL_MS);
    },
    [authorize, origin, stopHandoff],
  );

  return { openAuthorizeUrl, connectionError, clearConnectionError };
}
