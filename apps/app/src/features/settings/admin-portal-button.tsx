"use client";

import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { ShareUpRight } from "@preprocess/ui/lib/icons";

import { useWorkOsSdk } from "../workos-client-api/sdk";
import type { AdminPortalLinkIntent } from "../workos-client-api/vendor/generated";

/**
 * Opens a link in a new tab once it resolves. The tab opens synchronously on
 * the click, so popup blockers allow it; it closes again if the link fails.
 * (The widgets submit a target="_blank" form after the request instead.)
 */
export async function openInNewTab(resolveLink: () => Promise<string>) {
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null;
  try {
    const link = await resolveLink();
    if (tab) tab.location.href = link;
    else window.open(link, "_blank", "noopener,noreferrer");
  } catch (cause) {
    tab?.close();
    throw cause;
  }
}

/**
 * The widgets' "Set up / Continue setup / Manage ↗" button: mints an Admin
 * Portal link for one intent and opens it in a new tab.
 */
export function AdminPortalButton({
  intent,
  children,
  onError,
}: {
  intent: AdminPortalLinkIntent;
  children: string;
  onError?: (error: unknown) => void;
}) {
  const sdk = useWorkOsSdk();
  return (
    <LoadingButton
      onAction={() =>
        openInNewTab(async () => {
          const data = await sdk.CreateAdminPortalLink({ intent });
          return data.createAdminPortalLink.link;
        })
      }
      onError={onError}
      pendingLabel="Opening…"
      successLabel="Opened"
      trailingIcon={ShareUpRight}
      variant="secondary"
    >
      {children}
    </LoadingButton>
  );
}
