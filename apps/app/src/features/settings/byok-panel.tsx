"use client";

// Bring Your Own Key has no Client API intent, so the Admin Portal link is
// minted server-side; the row matches the other Admin Portal hand-offs.

import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { ShareUpRight } from "@preprocess/ui/lib/icons";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { generateAdminPortalLink } from "../workos-client-api/admin-portal";
import { openInNewTab } from "./admin-portal-button";
import { SettingsError, SettingsRow, SettingsRows } from "./kit";

export function ByokPanel() {
  const createLink = useServerFn(generateAdminPortalLink);
  const [error, setError] = useState<unknown>(null);

  return (
    <div className="flex flex-col gap-3">
      <SettingsRows>
        <SettingsRow label="You haven't set up a customer-managed key yet.">
          <LoadingButton
            onAction={() => {
              setError(null);
              return openInNewTab(async () => {
                const { link } = await createLink({
                  data: { intent: "bring_your_own_key" },
                });
                return link;
              });
            }}
            onError={setError}
            pendingLabel="Opening…"
            successLabel="Opened"
            trailingIcon={ShareUpRight}
            variant="secondary"
          >
            Set up BYOK
          </LoadingButton>
        </SettingsRow>
      </SettingsRows>
      {error ? <SettingsError error={error} /> : null}
    </div>
  );
}
