"use client";

// Settings → Governance → Single sign-on (PRE-137): the organization's
// identity provider over SAML or OIDC, the email domains that sign in
// through it, and whether they must. Owners edit; Admins read it; Members
// get the no-access state. Locked plans and licenses keep the page header
// and show one row.

import { Button } from "@preprocess/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@preprocess/ui/components/field";
import { Input } from "@preprocess/ui/components/input";
import {
  AsyncActionAbortError,
  LoadingButton,
} from "@preprocess/ui/components/loading-button";
import { PasswordInput } from "@preprocess/ui/components/password-input";
import { Spinner } from "@preprocess/ui/components/spinner";
import { cn } from "@preprocess/ui/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { Switch } from "@preprocess/ui/components/switch";
import { Tabs, TabsItem } from "@preprocess/ui/components/tabs";
import { Textarea } from "@preprocess/ui/components/textarea";
import { useEffect, useState } from "react";

import { CouldntLoadArt, NothingCreatedArt } from "../../components/empty-art";
import { ApiError } from "../auth/client";
import { ErrorLine } from "./guardrails-panel";
import {
  formatDate,
  formatRelative,
  SettingsConfirmDialog,
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsEmpty,
  SettingsEmptyArtScope,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsSection,
} from "./kit";
import { SettingsStacked } from "./settings-widgets";
import {
  SsoError,
  useSso,
  useSsoActions,
  useSsoGroups,
  useSsoTest,
  type ConnectionInput,
} from "./sso-api";
import type { SsoDomain, SsoSettings, SsoTest } from "./sso-seed";
import {
  Breakable,
  CopyRow,
  CopyValue,
  Dot,
  Labelled,
  LockedFeature,
  Mono,
  SettingsLoadingSections,
  SettingsNoAccess,
  SettingsNote,
  Strong,
  WrapCopy,
} from "./sso-shared";

type Dialog =
  | { kind: "connect" }
  | { kind: "edit" }
  | { kind: "add-domain" }
  | { kind: "record"; domain: string }
  | { kind: "require" }
  | { kind: "remove" };

const NO_GROUP = "none";

/** "acme.com", "acme.com and acme.co.uk", "acme.com, acme.co.uk and acmelabs.io". */
const joinNames = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const isHttpsUrl = (text: string) => /^https:\/\/[^\s/]+/.test(text.trim());

const requireReady = (settings: SsoSettings) =>
  settings.connection !== null &&
  settings.domains.some((domain) => domain.status === "verified") &&
  settings.connection.lastTest?.ok === true;

export function SsoPanel() {
  const sso = useSso();
  if (sso.isError)
    return sso.error instanceof ApiError && sso.error.status === 403 ? (
      <SettingsNoAccess />
    ) : (
      <SettingsEmpty
        action={
          <Button
            onClick={() => void sso.refetch()}
            type="button"
            variant="secondary"
          >
            Try again
          </Button>
        }
        art={<CouldntLoadArt />}
        description="Something went wrong loading single sign-on. Try again."
        title="Couldn't load single sign-on"
      />
    );
  if (!sso.data)
    return (
      <SettingsLoadingSections
        sections={[
          ["Connection", 3],
          ["Domains", 2],
          ["Sign-in", 2],
        ]}
      />
    );
  const { access } = sso.data;
  if (access.reason === "plan")
    return (
      <LockedFeature
        description="People sign in through your identity provider, such as Okta, Entra ID or Google Workspace, over SAML or OIDC. Available on Enterprise."
        label="Single sign-on"
        link={access.role === "owner" ? "plans" : null}
      />
    );
  if (access.reason === "license_missing")
    return (
      <LockedFeature
        description="Your license key doesn't include single sign-on. Contact Preprocess for an updated key, then set it on this install."
        label="Single sign-on"
        link="license"
      />
    );
  return <Loaded settings={sso.data} />;
}

function Loaded({ settings }: { settings: SsoSettings }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };
  const readOnly = !settings.access.canEdit;
  const record =
    dialog?.kind === "record"
      ? settings.domains.find((domain) => domain.domain === dialog.domain)
      : undefined;
  return (
    <SettingsEmptyArtScope>
      <SettingsStacked>
        <ConnectionSection
          onDialog={setDialog}
          readOnly={readOnly}
          settings={settings}
        />
        {settings.connection ? (
          <ProviderValues readOnly={readOnly} settings={settings} />
        ) : null}
        <DomainsSection
          onDialog={setDialog}
          readOnly={readOnly}
          settings={settings}
        />
        <SignInSection
          onDialog={setDialog}
          readOnly={readOnly}
          settings={settings}
        />
        {settings.access.role === "admin" ? (
          <SettingsNote>Only Owners can change single sign-on.</SettingsNote>
        ) : null}
      </SettingsStacked>
      <ConnectionDialog
        editing={dialog?.kind === "edit"}
        onOpenChange={close}
        open={dialog?.kind === "connect" || dialog?.kind === "edit"}
        settings={settings}
      />
      <AddDomainDialog
        onAdded={(domain) => setDialog({ kind: "record", domain })}
        onOpenChange={close}
        open={dialog?.kind === "add-domain"}
      />
      {record ? (
        <DomainRecordDialog domain={record} onOpenChange={close} />
      ) : null}
      <RequireDialog
        domains={settings.domains
          .filter((domain) => domain.status === "verified")
          .map((domain) => domain.domain)}
        onOpenChange={close}
        open={dialog?.kind === "require"}
      />
      <RemoveConnectionDialog
        onOpenChange={close}
        open={dialog?.kind === "remove"}
      />
    </SettingsEmptyArtScope>
  );
}

type SectionProps = {
  settings: SsoSettings;
  readOnly: boolean;
  onDialog: (dialog: Dialog) => void;
};

function ConnectionSection({ settings, readOnly, onDialog }: SectionProps) {
  const { connection, access } = settings;
  return (
    <SettingsSection
      actions={
        connection && !readOnly ? (
          <>
            <Button
              onClick={() => onDialog({ kind: "edit" })}
              size="compact"
              type="button"
              variant="secondary"
            >
              Edit
            </Button>
            <SettingsRowMenu
              actions={[
                {
                  label: "Remove connection",
                  onSelect: () => onDialog({ kind: "remove" }),
                },
              ]}
              label="Connection actions"
            />
          </>
        ) : undefined
      }
      description={
        access.reason === "license_expired" && access.licenseExpiredAt
          ? `Your license expired on ${formatDate(access.licenseExpiredAt)}. People can still sign in through your identity provider, but these settings are read-only until the license is renewed.`
          : "How people sign in through your identity provider."
      }
      title="Connection"
    >
      {!connection ? (
        <SettingsEmpty
          action={
            readOnly ? undefined : (
              <Button
                onClick={() => onDialog({ kind: "connect" })}
                type="button"
              >
                Connect provider
              </Button>
            )
          }
          art={<NothingCreatedArt />}
          description="Connect Okta, Entra ID, Google Workspace or any SAML or OIDC provider so people can sign in with their work account."
          title="No identity provider yet"
        />
      ) : (
        <SettingsRows>
          <SettingsRow
            label="Protocol"
            value={
              <Strong>
                {connection.protocol === "oidc" ? "OIDC" : "SAML"}
              </Strong>
            }
          />
          {connection.oidc ? (
            <>
              <SettingsRow
                label="Issuer"
                value={<Mono>{connection.oidc.issuer}</Mono>}
              />
              <SettingsRow
                label="Client ID"
                value={<Mono>{connection.oidc.clientId}</Mono>}
              />
              {connection.oidc.hasSecret ? (
                <SettingsRow
                  description="Saved. You can replace it, but not view it."
                  label="Client secret"
                  value={<Mono>••••••••••••</Mono>}
                />
              ) : null}
            </>
          ) : null}
          {connection.saml ? (
            <>
              <SettingsRow
                description={
                  connection.saml.metadataReadAt
                    ? `Read ${formatDate(connection.saml.metadataReadAt)}`
                    : undefined
                }
                label="Metadata"
                value={
                  connection.saml.metadataUrl ? (
                    <Mono>{connection.saml.metadataUrl}</Mono>
                  ) : (
                    <span className="text-body">Pasted XML</span>
                  )
                }
              />
              {connection.saml.certificateExpiresAt ? (
                <SettingsRow
                  label="Signing certificate"
                  value={
                    <span className="text-body">
                      Expires {formatDate(connection.saml.certificateExpiresAt)}
                    </span>
                  }
                />
              ) : null}
            </>
          ) : null}
          <TestRow lastTest={connection.lastTest} readOnly={readOnly} />
        </SettingsRows>
      )}
    </SettingsSection>
  );
}

// Hints for a failed test by the identity provider's reason. Only these are
// approved copy; other reasons show the provider's answer alone.
const TEST_HINTS: Partial<
  Record<Extract<SsoTest, { ok: false }>["reason"], string>
> = {
  audience_mismatch: "Check the entity ID in the SAML app.",
};

function TestResult({
  test,
  justNow,
}: {
  test: SsoTest | null;
  justNow: boolean;
}) {
  if (!test)
    return <span className="text-body text-muted-foreground">Not tested</span>;
  if (!test.ok) {
    const hint = TEST_HINTS[test.reason];
    return (
      <div className="flex min-w-0 flex-col items-start gap-1">
        <Dot color="red">Failed</Dot>
        <p className="text-caption break-words text-destructive">
          Your identity provider answered: “{test.idpMessage.replace(/\.$/, "")}
          .”
          {hint ? ` ${hint}` : null}
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Dot color="green">Passed</Dot>
      <p className="text-caption text-muted-foreground">
        {justNow
          ? `${test.by.name} signed in as ${test.email} just now.`
          : `${formatDate(test.at)}, by ${test.by.name}`}
      </p>
    </div>
  );
}

function TestRow({
  lastTest,
  readOnly,
}: {
  lastTest: SsoTest | null;
  readOnly: boolean;
}) {
  const test = useSsoTest(lastTest?.at ?? null);
  return (
    <SettingsRow
      description="Sign in through your identity provider once to check the connection."
      label="Test sign-in"
      value={<TestResult justNow={test.justTested} test={lastTest} />}
    >
      {readOnly ? null : (
        <Button
          disabled={test.testing}
          onClick={test.start}
          size="compact"
          type="button"
          variant="secondary"
        >
          Test connection
        </Button>
      )}
    </SettingsRow>
  );
}

function ProviderValues({
  settings,
  readOnly,
}: {
  settings: SsoSettings;
  readOnly: boolean;
}) {
  const oidc = settings.connection?.protocol === "oidc";
  const sp = settings.serviceProvider;
  return (
    <SettingsSection
      description={
        oidc
          ? "Add this to the OIDC app in your identity provider."
          : "Add these to the SAML app in your identity provider."
      }
      title="Values for your identity provider"
    >
      <SettingsRows>
        {oidc ? (
          <CopyRow
            disabled={readOnly}
            label="Redirect URI"
            value={sp.redirectUri}
          />
        ) : (
          <>
            <CopyRow
              description="Also called the reply URL"
              disabled={readOnly}
              label="ACS URL"
              value={sp.acsUrl}
            />
            <CopyRow
              description="Also called the audience URI"
              disabled={readOnly}
              label="Entity ID"
              value={sp.entityId}
            />
          </>
        )}
      </SettingsRows>
    </SettingsSection>
  );
}

function domainDescription(domain: SsoDomain) {
  const checked = domain.checkedAt ? formatRelative(domain.checkedAt) : null;
  switch (domain.status) {
    case "verified":
      return checked ? `Checked ${checked}` : undefined;
    case "pending":
      return checked
        ? `Add the TXT record at your DNS provider. Last checked ${checked}.`
        : "Add the TXT record at your DNS provider.";
    case "failed":
      return (
        <span className="text-destructive">
          {domain.failureReason === "record_missing" ? (
            <>
              No TXT record found at <Breakable text={domain.record.name} />.
            </>
          ) : null}
          {domain.failureReason === "record_missing" && checked ? " " : null}
          {checked ? `Last checked ${checked}.` : null}
        </span>
      );
  }
}

const DOMAIN_BADGE = {
  verified: ["green", "Verified"],
  pending: ["amber", "Pending"],
  failed: ["red", "Failed"],
} as const;

function DomainRow({
  domain,
  readOnly,
  onDialog,
  onError,
}: {
  domain: SsoDomain;
  readOnly: boolean;
  onDialog: (dialog: Dialog) => void;
  onError: (error: unknown) => void;
}) {
  const actions = useSsoActions();
  const [checking, setChecking] = useState(false);
  const [color, status] = DOMAIN_BADGE[domain.status];
  const remove = {
    label: "Remove",
    onSelect: () => {
      onError(null);
      actions.removeDomain(domain.domain).catch(onError);
    },
  };
  return (
    <SettingsRow
      description={domainDescription(domain)}
      label={
        <Labelled
          badge={<Dot color={color}>{status}</Dot>}
          label={domain.domain}
        />
      }
    >
      {readOnly ? null : domain.status === "verified" ? (
        <SettingsRowMenu
          actions={[remove]}
          label={`${domain.domain} actions`}
        />
      ) : (
        <>
          <Button
            aria-busy={checking || undefined}
            onClick={() => {
              if (checking) return;
              onError(null);
              setChecking(true);
              actions
                .checkDomain(domain.domain)
                .catch(onError)
                .finally(() => setChecking(false));
            }}
            size="compact"
            variant="secondary"
          >
            <span className="grid place-items-center">
              <span
                className={cn(
                  "col-start-1 row-start-1",
                  checking && "invisible",
                )}
              >
                Check now
              </span>
              {checking ? (
                <Spinner className="col-start-1 row-start-1 size-3.5" />
              ) : null}
            </span>
          </Button>
          <SettingsRowMenu
            actions={[
              {
                label: "Show record",
                onSelect: () =>
                  onDialog({ kind: "record", domain: domain.domain }),
              },
              remove,
            ]}
            label={`${domain.domain} actions`}
          />
        </>
      )}
    </SettingsRow>
  );
}

function DomainsSection({ settings, readOnly, onDialog }: SectionProps) {
  const [error, setError] = useState<unknown>(null);
  return (
    <SettingsSection
      actions={
        readOnly ? undefined : (
          <Button
            onClick={() => onDialog({ kind: "add-domain" })}
            size="compact"
            type="button"
            variant="secondary"
          >
            Add domain
          </Button>
        )
      }
      description="People with an email at a verified domain sign in through your identity provider."
      title="Domains"
    >
      {settings.domains.length === 0 ? (
        <SettingsEmpty
          art={<NothingCreatedArt />}
          description="Add the email domain your team signs in with, such as acme.com."
          title="No domains yet"
        />
      ) : (
        <SettingsRows>
          {settings.domains.map((domain) => (
            <DomainRow
              domain={domain}
              key={domain.domain}
              onDialog={onDialog}
              onError={setError}
              readOnly={readOnly}
            />
          ))}
        </SettingsRows>
      )}
      <ErrorLine error={error} fallback="Something went wrong. Try again." />
    </SettingsSection>
  );
}

function SignInSection({ settings, readOnly, onDialog }: SectionProps) {
  const actions = useSsoActions();
  const { connection } = settings;
  const groups = useSsoGroups(Boolean(connection?.jit));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const required = connection?.requireSso ?? false;
  const jit = connection?.jit ?? false;
  const canRequire = requireReady(settings);

  const change = (next: Parameters<typeof actions.changeSignIn>[0]) => {
    setError(null);
    setPending(true);
    actions
      .changeSignIn(next)
      .catch(setError)
      .finally(() => setPending(false));
  };

  return (
    <SettingsSection title="Sign-in">
      <SettingsRows>
        <SettingsRow
          description={
            canRequire || required
              ? "Everyone at a verified domain signs in through your identity provider. Owners can still sign in with an email link if it's down."
              : "Verify a domain and pass a test sign-in first."
          }
          label="Require SSO"
        >
          <Switch
            checked={required}
            disabled={readOnly || pending || (!canRequire && !required)}
            label={required ? "On" : "Off"}
            onToggle={() =>
              required
                ? change({ requireSso: false })
                : onDialog({ kind: "require" })
            }
          />
        </SettingsRow>
        <SettingsRow
          description={
            connection
              ? "Add people the first time they sign in through your identity provider."
              : "Connect a provider first."
          }
          label="Just-in-time provisioning"
        >
          <Switch
            checked={jit}
            disabled={readOnly || pending || !connection}
            label={jit ? "On" : "Off"}
            onToggle={() => change({ jit: !jit })}
          />
        </SettingsRow>
        {connection && jit ? (
          <SettingsRow
            description="New people join this group. Groups decide which agents they can see."
            label="Default group"
            value={
              <Select
                disabled={readOnly || pending}
                onValueChange={(value) =>
                  change({ defaultGroupId: value === NO_GROUP ? null : value })
                }
                value={connection.defaultGroupId ?? NO_GROUP}
              >
                <SelectTrigger
                  aria-label="Default group"
                  className="w-52 max-w-full"
                />
                <SelectContent>
                  <SelectItem index={0} value={NO_GROUP}>
                    No group
                  </SelectItem>
                  {(groups.data ?? [])
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((group, index) => (
                      <SelectItem
                        index={index + 1}
                        key={group.id}
                        value={group.id}
                      >
                        {group.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            }
          />
        ) : null}
      </SettingsRows>
      <ErrorLine error={error} fallback="Something went wrong. Try again." />
    </SettingsSection>
  );
}

/** A hairline across the dialog body, edge to edge. */
function Hairline() {
  return <div className="-mx-6 border-t border-border/60" />;
}

type Draft = {
  protocol: 0 | 1;
  source: 0 | 1;
  metadataUrl: string;
  metadataXml: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
};

const draftFrom = (settings: SsoSettings, editing: boolean): Draft => {
  const connection = editing ? settings.connection : null;
  return {
    protocol: connection?.protocol === "oidc" ? 1 : 0,
    source: connection?.saml?.pastedXml ? 1 : 0,
    metadataUrl: connection?.saml?.metadataUrl ?? "",
    metadataXml: "",
    issuer: connection?.oidc?.issuer ?? "",
    clientId: connection?.oidc?.clientId ?? "",
    clientSecret: "",
  };
};

function ConnectionDialog({
  open,
  onOpenChange,
  settings,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SsoSettings;
  editing: boolean;
}) {
  const actions = useSsoActions();
  const [draft, setDraft] = useState(() => draftFrom(settings, editing));
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!open) return;
    setDraft(draftFrom(settings, editing));
    setInvalid(false);
    setError(null);
  }, [open, editing]);

  const oidc = draft.protocol === 1;
  const xml = !oidc && draft.source === 1;
  const hasSecret = editing && Boolean(settings.connection?.oidc?.hasSecret);
  const set = (change: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...change }));
    if ("metadataUrl" in change || "issuer" in change) setInvalid(false);
  };
  const complete = oidc
    ? draft.issuer.trim() !== "" && draft.clientId.trim() !== ""
    : xml
      ? draft.metadataXml.trim() !== ""
      : draft.metadataUrl.trim() !== "";

  const input = (): ConnectionInput =>
    oidc
      ? {
          protocol: "oidc",
          issuer: draft.issuer.trim(),
          clientId: draft.clientId.trim(),
          ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
        }
      : xml
        ? { protocol: "saml", metadataXml: draft.metadataXml }
        : { protocol: "saml", metadataUrl: draft.metadataUrl.trim() };

  const message =
    error instanceof SsoError && error.code === "metadata_unreadable"
      ? `Couldn't read the metadata: the URL returned ${error.upstreamStatus ?? error.status}.`
      : error instanceof Error
        ? error.message
        : null;

  return (
    <SettingsDialogShell
      description={
        editing
          ? "Changes apply the next time someone signs in."
          : "Set up SAML or OIDC for your identity provider."
      }
      onOpenChange={onOpenChange}
      open={open}
      size="lg"
      title={editing ? "Edit connection" : "Connect provider"}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <Field>
          <FieldLabel>Protocol</FieldLabel>
          <Tabs
            aria-label="Protocol"
            onSelect={(index) => set({ protocol: index === 1 ? 1 : 0 })}
            selectedIndex={draft.protocol}
            size="compact"
          >
            <TabsItem index={0} label="SAML" />
            <TabsItem index={1} label="OIDC" />
          </Tabs>
        </Field>
        {oidc ? (
          <>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="sso-issuer">Issuer URL</FieldLabel>
              <Input
                aria-invalid={invalid || undefined}
                id="sso-issuer"
                onChange={(event) => set({ issuer: event.target.value })}
                value={draft.issuer}
              />
              {invalid ? (
                <FieldError>Use an https:// URL.</FieldError>
              ) : (
                <FieldDescription>
                  We read the rest of the settings from its discovery document.
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="sso-client">Client ID</FieldLabel>
              <Input
                id="sso-client"
                onChange={(event) => set({ clientId: event.target.value })}
                value={draft.clientId}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="sso-secret">Client secret</FieldLabel>
              <PasswordInput
                id="sso-secret"
                onChange={(event) => set({ clientSecret: event.target.value })}
                placeholder={hasSecret ? "Saved secret" : undefined}
                value={draft.clientSecret}
              />
              {hasSecret ? (
                <FieldDescription>
                  A secret is saved. Leave this empty to keep it.
                </FieldDescription>
              ) : null}
            </Field>
            <Hairline />
            <WrapCopy
              field
              label="Redirect URI"
              value={settings.serviceProvider.redirectUri}
            />
          </>
        ) : (
          <>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="sso-metadata">Metadata</FieldLabel>
              <Tabs
                aria-label="Metadata source"
                onSelect={(index) => set({ source: index === 1 ? 1 : 0 })}
                selectedIndex={draft.source}
                size="compact"
              >
                <TabsItem index={0} label="From a URL" />
                <TabsItem index={1} label="Paste XML" />
              </Tabs>
              {xml ? (
                <Textarea
                  className="font-mono"
                  id="sso-metadata"
                  onChange={(event) => set({ metadataXml: event.target.value })}
                  rows={5}
                  value={draft.metadataXml}
                />
              ) : (
                <Input
                  aria-invalid={invalid || undefined}
                  id="sso-metadata"
                  onChange={(event) => set({ metadataUrl: event.target.value })}
                  value={draft.metadataUrl}
                />
              )}
              {invalid ? (
                <FieldError>Use an https:// URL.</FieldError>
              ) : (
                <FieldDescription>
                  {xml
                    ? "Download it from the SAML app in your identity provider."
                    : "Your identity provider shows it on the SAML app. We read it again when its certificate changes."}
                </FieldDescription>
              )}
            </Field>
            {message ? (
              <SettingsPanelMessage tone="danger">
                {message}
              </SettingsPanelMessage>
            ) : null}
            <Hairline />
            <WrapCopy
              field
              label="ACS URL"
              value={settings.serviceProvider.acsUrl}
            />
            <WrapCopy
              field
              label="Entity ID"
              value={settings.serviceProvider.entityId}
            />
          </>
        )}
        {oidc && message ? (
          <SettingsPanelMessage tone="danger">{message}</SettingsPanelMessage>
        ) : null}
        <SettingsDialogActions onCancel={() => onOpenChange(false)}>
          <LoadingButton
            disabled={!complete}
            onAction={async () => {
              setError(null);
              const url = oidc ? draft.issuer : xml ? null : draft.metadataUrl;
              if (url !== null && !isHttpsUrl(url)) {
                setInvalid(true);
                throw new AsyncActionAbortError();
              }
              await actions.saveConnection(input());
            }}
            onError={setError}
            onStatusChange={(status) => {
              if (status === "success")
                window.setTimeout(() => onOpenChange(false), 600);
            }}
            pendingLabel="Saving…"
          >
            Save
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}

function AddDomainDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (domain: string) => void;
}) {
  const actions = useSsoActions();
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!open) return;
    setDomain("");
    setError(null);
  }, [open]);
  return (
    <SettingsDialogShell
      description="Once it's verified, people with an email at this domain sign in through your identity provider."
      onOpenChange={onOpenChange}
      open={open}
      title="Add domain"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="sso-domain">Domain</FieldLabel>
          <Input
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            id="sso-domain"
            onChange={(event) => {
              setDomain(event.target.value);
              setError(null);
            }}
            placeholder="acme.com"
            value={domain}
          />
          {error instanceof Error ? (
            <FieldError>{error.message}</FieldError>
          ) : null}
        </Field>
        <SettingsDialogActions onCancel={() => onOpenChange(false)}>
          <LoadingButton
            disabled={domain.trim() === ""}
            onAction={async () => {
              setError(null);
              const added = await actions.addDomain(domain.trim());
              if (added.status === "verified") onOpenChange(false);
              else onAdded(added.domain);
            }}
            onError={setError}
          >
            Add domain
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}

function DomainRecordDialog({
  domain,
  onOpenChange,
}: {
  domain: SsoDomain;
  onOpenChange: (open: boolean) => void;
}) {
  const actions = useSsoActions();
  const [error, setError] = useState<unknown>(null);
  return (
    <SettingsDialogShell
      description="Add this TXT record at your DNS provider, then check. New records can take up to a day to appear."
      onOpenChange={onOpenChange}
      open
      size="lg"
      title={`Verify ${domain.domain}`}
    >
      <div className="-mx-6 flex flex-col divide-y divide-border/60 border-y border-border/60">
        <SettingsRow
          label="Type"
          value={<Strong>{domain.record.type}</Strong>}
        />
        <SettingsRow
          label="Name"
          value={<CopyValue label="Name" value={domain.record.name} />}
        />
        <SettingsRow
          label="Value"
          value={<CopyValue label="Value" value={domain.record.value} />}
        />
      </div>
      <ErrorLine error={error} fallback="Something went wrong. Try again." />
      <SettingsDialogActions
        cancelLabel="Close"
        onCancel={() => onOpenChange(false)}
      >
        <LoadingButton
          onAction={async () => {
            setError(null);
            await actions.checkDomain(domain.domain);
          }}
          onError={setError}
          onStatusChange={(status) => {
            if (status === "success")
              window.setTimeout(() => onOpenChange(false), 600);
          }}
        >
          Check now
        </LoadingButton>
      </SettingsDialogActions>
    </SettingsDialogShell>
  );
}

function RequireDialog({
  open,
  onOpenChange,
  domains,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domains: readonly string[];
}) {
  const actions = useSsoActions();
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return (
    <SettingsDialogShell
      description={`Everyone at ${joinNames(domains)} will sign in through your identity provider from now on. Anyone signed in with an email link will need to sign in again.`}
      onOpenChange={onOpenChange}
      open={open}
      title="Require SSO?"
    >
      <SettingsPanelMessage>
        Owners can still sign in with an email link, so you can get back in if
        your identity provider is down.
      </SettingsPanelMessage>
      {error instanceof Error ? (
        <SettingsPanelMessage tone="danger">
          {error.message}
        </SettingsPanelMessage>
      ) : null}
      <SettingsDialogActions onCancel={() => onOpenChange(false)}>
        <LoadingButton
          onAction={async () => {
            setError(null);
            await actions.changeSignIn({ requireSso: true });
          }}
          onError={setError}
          onStatusChange={(status) => {
            if (status === "success")
              window.setTimeout(() => onOpenChange(false), 600);
          }}
        >
          Require SSO
        </LoadingButton>
      </SettingsDialogActions>
    </SettingsDialogShell>
  );
}

function RemoveConnectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const actions = useSsoActions();
  return (
    <SettingsConfirmDialog
      confirmLabel="Remove"
      description="People will sign in with an email link instead. Require SSO turns off."
      onConfirm={actions.removeConnection}
      onOpenChange={onOpenChange}
      open={open}
      pendingLabel="Removing…"
      title="Remove connection?"
    />
  );
}
