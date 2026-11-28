"use client";

// Settings → Self-hosted → License (spec 16): the install's license key, its
// customer, seat limit and expiry, and an Owner pasting a new key. Owners and
// Admins of a self-hosted install only; Admins read it. In grace or past it,
// the page carries the larger callout; the sidebar notice links here.

import {
  AsyncActionAbortError,
  LoadingButton,
} from "@preprocess/ui/components/loading-button";
import { useRef, useState } from "react";

import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";
import { ErrorLine } from "./guardrails-panel";
import {
  formatDate,
  SettingsCard,
  SettingsError,
  SettingsRow,
  SettingsRows,
  SettingsRowSkeleton,
  SettingsSection,
  SettingsStatus,
  type SettingsStatusState,
  SkeletonField,
} from "./kit";
import { useLicense, useUploadLicense, type LicenseRole } from "./license-api";
import type { License } from "./license-seed";
import { SettingsStacked } from "./settings-widgets";

const STATUS: Record<
  License["status"],
  { label: string; state: SettingsStatusState }
> = {
  active: { label: "Active", state: "success" },
  grace: { label: "In grace period", state: "warning" },
  expired: { label: "Expired", state: "error" },
  invalid: { label: "Invalid", state: "error" },
  none: { label: "No license", state: "neutral" },
};

const KEEPS_WORKING = "The free product and your data keep working.";

const statusDescription = (license: License) => {
  switch (license.status) {
    case "grace":
      return `Paid features end ${license.graceEndsAt ? formatDate(license.graceEndsAt) : "soon"}. Upload a renewed key to keep them on.`;
    case "expired":
      return `Paid features are off since ${license.expiresAt ? formatDate(license.expiresAt) : "the license expired"}. Upload a renewed key to turn them back on.`;
    case "invalid":
      return "Paid features are off until a valid key is uploaded.";
    case "none":
      return "Paid features need a license key from Preprocess.";
    case "active":
      return undefined;
  }
};

const seatsLabel = ({ used, limit }: License["seats"]) =>
  limit === null
    ? `${used.toLocaleString("en-US")} used`
    : `${used.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} used`;

const sourceLabel = (license: License) =>
  license.source === "upload"
    ? `Uploaded${license.uploadedAt ? ` ${formatDate(license.uploadedAt)}` : ""}`
    : license.source === "environment"
      ? "Set in the install's configuration"
      : "None";

function Details({ license }: { license: License }) {
  const status = STATUS[license.status];
  const licensed = license.customer !== null;
  return (
    <SettingsRows>
      <SettingsRow
        description={statusDescription(license)}
        label="Status"
        value={
          <SettingsStatus state={status.state}>{status.label}</SettingsStatus>
        }
      />
      {licensed ? (
        <SettingsRow label="Customer" value={license.customer} />
      ) : null}
      <SettingsRow
        description="Developers and operators."
        label="Seats"
        value={seatsLabel(license.seats)}
      />
      {license.expiresAt ? (
        <SettingsRow
          label={license.status === "active" ? "Expires" : "Expired"}
          value={formatDate(license.expiresAt)}
        />
      ) : null}
      {license.graceEndsAt ? (
        <SettingsRow
          description="Paid features stay on for 30 days after the license expires."
          label={
            license.status === "expired"
              ? "Grace period ended"
              : "Grace period ends"
          }
          value={formatDate(license.graceEndsAt)}
        />
      ) : null}
      <SettingsRow label="Key" value={sourceLabel(license)} />
    </SettingsRows>
  );
}

const validateKey = (text: string) =>
  text.trim() === "" ? "Paste a license key." : null;

function UploadKey() {
  const upload = useUploadLicense();
  const field = useRef<ValidatedFieldHandle>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState<unknown>(null);
  return (
    <SettingsSection
      actions={
        <LoadingButton
          disabled={key.trim() === ""}
          onAction={async () => {
            setError(null);
            if (!field.current?.commit()) throw new AsyncActionAbortError();
            await upload(key.trim());
            setKey("");
            field.current?.reset();
          }}
          onError={setError}
          pendingLabel="Uploading…"
          successLabel="Uploaded"
        >
          Upload key
        </LoadingButton>
      }
      description="Paste the key from Preprocess. It replaces the current key for the whole install."
      title="Upload a key"
    >
      <SettingsCard className="px-5 py-4">
        <ValidatedField
          autoComplete="off"
          hint="One line, exactly as Preprocess sent it."
          label="License key"
          onChange={setKey}
          placeholder="eyJraWQiOi…"
          ref={field}
          validate={validateKey}
          value={key}
        />
      </SettingsCard>
      <ErrorLine error={error} fallback="Could not upload the license key." />
    </SettingsSection>
  );
}

export function LicensePanel({ role }: { role: LicenseRole }) {
  const license = useLicense();
  const owner = role === "owner";
  return (
    <SettingsStacked>
      <SettingsSection
        description={`The license key turns on paid features for this self-hosted install. It is checked offline, on this install.${owner ? "" : " Only Owners can upload a key."}${license.data && license.data.status !== "active" ? ` ${KEEPS_WORKING}` : ""}`}
        title="License"
      >
        {license.isError ? (
          <SettingsError error={license.error} />
        ) : !license.data ? (
          <SettingsRows>
            {["Status", "Customer", "Seats", "Expires"].map((label) => (
              <SettingsRowSkeleton
                key={label}
                label={label}
                value={<SkeletonField className="w-40" />}
              />
            ))}
          </SettingsRows>
        ) : (
          <Details license={license.data} />
        )}
      </SettingsSection>
      {owner ? <UploadKey /> : null}
    </SettingsStacked>
  );
}
