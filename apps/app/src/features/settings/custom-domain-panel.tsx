"use client";

import { Button } from "@preprocess/ui/components/button";
import { InputCopy } from "@preprocess/ui/components/input-copy";
import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { Globe } from "@preprocess/ui/lib/icons";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  SettingsEmpty,
  SettingsIconTile,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsStatus,
} from "./kit";
import {
  SettingsDialog,
  SettingsDialogActions,
  SettingsPanelMessage,
} from "./kit";

export type CustomHostnameStatus = "pending" | "active" | "error";

export type CustomHostname = {
  hostname: string;
  id: string;
  status: CustomHostnameStatus;
};

// TODO: replace with the Cloudflare for SaaS fallback origin.
export const CUSTOM_HOSTNAME_CNAME_TARGET = "customers.preprocess.com";

export function validateCustomHostname(value: string) {
  const hostname = value.trim().toLowerCase();
  if (!hostname) return "Enter a hostname.";
  if (hostname.includes("://") || hostname.includes("/")) {
    return "Enter a hostname, not a URL.";
  }
  if (
    !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(
      hostname,
    )
  ) {
    return "Enter a valid hostname.";
  }
  return null;
}

export function customHostnameStatus(hostname: CustomHostname) {
  switch (hostname.status) {
    case "pending":
      return {
        detail: "Add the CNAME record at your DNS provider.",
        kind: "waiting" as const,
        label: "Waiting for DNS",
      };
    case "active":
      return {
        detail: "This hostname points at Preprocess.",
        kind: "success" as const,
        label: "Active",
      };
    case "error":
      return {
        detail: "We could not verify the CNAME record.",
        kind: "error" as const,
        label: "Not connected",
      };
    default: {
      const _exhaustive: never = hostname.status;
      return _exhaustive;
    }
  }
}

export function CustomDomainDnsBody({ hostname }: { hostname: string }) {
  return (
    <div className="flex flex-col gap-3">
      <SettingsPanelMessage>
        Point this hostname at Preprocess with a CNAME. This is not used for
        email login or SSO.
      </SettingsPanelMessage>
      <div className="flex flex-col gap-2 text-body">
        <p>
          <span className="text-muted-foreground">Type</span>
          <span className="ml-2 text-foreground">CNAME</span>
        </p>
        <InputCopy label="Name" value={hostname} />
        <InputCopy label="Target" value={CUSTOM_HOSTNAME_CNAME_TARGET} />
      </div>
    </div>
  );
}

function AddCustomHostnameDialog({ close }: { close: () => void }) {
  const hostnameRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [hostname, setHostname] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        saveRef.current?.run();
      }}
    >
      <InlineValidation
        ref={hostnameRef}
        hint="Point this host at Preprocess with a CNAME. Not used for email login or SSO."
        id="organization-custom-hostname"
        label="Hostname"
        name="hostname"
        onChange={setHostname}
        validate={validateCustomHostname}
        value={hostname}
      />
      {error ? (
        <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
      ) : null}
      <SettingsDialogActions onCancel={close} pending={pending}>
        <LoadingButton
          ref={saveRef}
          onAction={() => {
            if (!hostnameRef.current?.commit()) {
              throw new AsyncActionAbortError();
            }
            setError(null);
            // TODO: create a Cloudflare for SaaS custom hostname for this org.
            setError("Custom hostnames are not available yet.");
            throw new AsyncActionAbortError();
          }}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Adding…"
          successLabel="Added"
          type="submit"
        >
          Add hostname
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}

export function CustomHostnameView({
  addAction,
  hostnames,
  onRemove,
  onViewDns,
}: {
  addAction: ReactNode;
  hostnames: CustomHostname[];
  onRemove?: (hostname: CustomHostname) => void;
  onViewDns?: (hostname: CustomHostname) => void;
}) {
  if (hostnames.length === 0) {
    return (
      <SettingsRows>
        <SettingsEmpty
          action={addAction}
          description="Add a hostname that points at this organization."
          title="No custom domain"
        />
      </SettingsRows>
    );
  }

  return (
    <SettingsRows>
      {hostnames.map((hostname) => {
        const status = customHostnameStatus(hostname);
        const actions = [
          ...(onViewDns
            ? [
                {
                  label: "View DNS record",
                  onSelect: () => onViewDns(hostname),
                },
              ]
            : []),
          ...(onRemove
            ? [{ label: "Remove hostname", onSelect: () => onRemove(hostname) }]
            : []),
        ];
        return (
          <SettingsRow
            description={status.detail}
            key={hostname.id}
            label={hostname.hostname}
            leading={<SettingsIconTile icon={Globe} />}
          >
            <SettingsStatus state={status.kind}>{status.label}</SettingsStatus>
            {actions.length > 0 ? (
              <SettingsRowMenu
                actions={actions}
                label={`Actions for ${hostname.hostname}`}
              />
            ) : null}
          </SettingsRow>
        );
      })}
      <div className="flex justify-end py-3">{addAction}</div>
    </SettingsRows>
  );
}

export function CustomDomainPanel() {
  const addButton = (
    <SettingsDialog
      description="Point a hostname at this organization. This is not used for email login or SSO."
      title="Add hostname"
      content={(close) => <AddCustomHostnameDialog close={close} />}
    >
      <Button type="button" variant="secondary">
        Add hostname
      </Button>
    </SettingsDialog>
  );

  return <CustomHostnameView addAction={addButton} hostnames={[]} />;
}
