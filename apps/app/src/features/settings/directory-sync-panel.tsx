"use client";

// Settings → Governance → Directory sync (PRE-138): the SCIM endpoint and
// token the organization's identity provider uses, and what it synced. Owners
// edit; Admins read it; Members get the no-access state. Locked plans and
// licenses keep the page header and show one row.

import { Button } from "@preprocess/ui/components/button";
import { Spinner } from "@preprocess/ui/components/spinner";
import { ChevronRight } from "@preprocess/ui/lib/icons";
import { cn } from "@preprocess/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { CouldntLoadArt, DirectorySyncArt } from "../../components/empty-art";
import { ApiError } from "../auth/client";
import { PAGE_FORWARD } from "../groups/groups-panel";
import {
  CantDeleteGroupDialog,
  type NamingDeployment,
} from "../groups/cant-delete-group";
import {
  namingDeployments,
  seededDialog,
  useDirectorySync,
  useDirectorySyncActions,
} from "./directory-sync-api";
import {
  SEEDED_SECRET,
  type DirectorySync,
  type ScimGroup,
} from "./directory-sync-seed";
import { ErrorLine } from "./guardrails-panel";
import {
  formatDate,
  formatRelative,
  SettingsConfirmDialog,
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
  CopyRow,
  Dot,
  Labelled,
  LockedFeature,
  Mono,
  SettingsLoadingSections,
  SettingsNoAccess,
  SettingsNote,
  WrapCopy,
} from "./sso-shared";

type Dialog =
  | { kind: "token"; secret: string }
  | { kind: "regenerate" }
  | { kind: "revoke" }
  | { kind: "delete"; group: ScimGroup }
  | { kind: "refused"; group: ScimGroup; namedBy: NamingDeployment[] };

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const dayMonth = (value: string) =>
  new Date(value).toLocaleDateString("en", { month: "short", day: "numeric" });

export function DirectorySyncPanel() {
  const sync = useDirectorySync();
  if (sync.isError)
    return sync.error instanceof ApiError && sync.error.status === 403 ? (
      <SettingsNoAccess />
    ) : (
      <SettingsEmpty
        action={
          <Button
            onClick={() => void sync.refetch()}
            type="button"
            variant="secondary"
          >
            Try again
          </Button>
        }
        art={<CouldntLoadArt />}
        description="Something went wrong loading directory sync. Try again."
        title="Couldn't load directory sync"
      />
    );
  if (!sync.data)
    return (
      <SettingsLoadingSections
        sections={[
          ["Connection", 2],
          ["Synced from your identity provider", 4],
        ]}
      />
    );
  const { settings, role } = sync.data;
  if (settings.reason === "plan")
    return (
      <LockedFeature
        description="Your identity provider adds, updates and removes people and groups here over SCIM. Available on Enterprise."
        label="Directory sync"
        link={role === "owner" ? "plans" : null}
      />
    );
  if (settings.reason === "license_missing")
    return (
      <LockedFeature
        description="Your license key doesn't include directory sync. Contact Preprocess for an updated key, then set it on this install."
        label="Directory sync"
        link="license"
      />
    );
  return <Loaded role={role} settings={settings} />;
}

function initialDialog(): Dialog | null {
  const seeded = seededDialog();
  if (seeded === "token") return { kind: "token", secret: SEEDED_SECRET };
  return seeded ? { kind: seeded } : null;
}

function Loaded({
  settings,
  role,
}: {
  settings: DirectorySync;
  role: "owner" | "admin";
}) {
  const [dialog, setDialog] = useState<Dialog | null>(initialDialog);
  const actions = useDirectorySyncActions();
  const close = (kind: Dialog["kind"]) => (open: boolean) => {
    if (!open)
      setDialog((current) => (current?.kind === kind ? null : current));
  };
  const readOnly = !settings.canEdit;
  return (
    <SettingsEmptyArtScope>
      <SettingsStacked>
        <ConnectionSection
          onDialog={setDialog}
          readOnly={readOnly}
          settings={settings}
        />
        <SyncedSection
          onDialog={setDialog}
          readOnly={readOnly}
          settings={settings}
        />
        {role === "admin" ? (
          <SettingsNote>Only Owners can change directory sync.</SettingsNote>
        ) : null}
      </SettingsStacked>
      <SettingsDialogShell
        description="Paste it into your identity provider's SCIM settings as the bearer token."
        onOpenChange={close("token")}
        open={dialog?.kind === "token"}
        title="Your new SCIM token"
      >
        {dialog?.kind === "token" ? (
          <div className="flex flex-col gap-4">
            <WrapCopy
              field
              label="Bearer token"
              value={dialog.secret}
              wrap="anywhere"
            />
            <SettingsPanelMessage>
              Copy it now. It won't be shown again.
            </SettingsPanelMessage>
            <div className="flex justify-end">
              <Button onClick={() => setDialog(null)} type="button">
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </SettingsDialogShell>
      <SettingsConfirmDialog
        confirmLabel="Regenerate"
        description="The current token stops working immediately. Your identity provider can't sync until you paste in the new one."
        onConfirm={async () => {
          const issued = await actions.regenerate();
          setDialog({ kind: "token", secret: issued.token });
        }}
        onOpenChange={close("regenerate")}
        open={dialog?.kind === "regenerate"}
        pendingLabel="Regenerating…"
        title="Regenerate token?"
      />
      <SettingsConfirmDialog
        confirmLabel="Revoke"
        description="Your identity provider can't sync until you generate a new token. People and groups already synced stay as they are."
        onConfirm={() =>
          settings.token
            ? actions.revoke(settings.token.prefix)
            : Promise.resolve()
        }
        onOpenChange={close("revoke")}
        open={dialog?.kind === "revoke"}
        pendingLabel="Revoking…"
        title="Revoke token?"
      />
      <CantDeleteGroupDialog
        name={dialog?.kind === "refused" ? dialog.group.name : ""}
        namedBy={dialog?.kind === "refused" ? dialog.namedBy : []}
        onOpenChange={close("refused")}
        open={dialog?.kind === "refused"}
      />
      <SettingsConfirmDialog
        confirmLabel="Delete group"
        description={
          dialog?.kind === "delete"
            ? `Every agent grant ${dialog.group.name} holds is removed with it.`
            : undefined
        }
        onConfirm={() =>
          dialog?.kind === "delete"
            ? actions.deleteGroup(dialog.group.id)
            : Promise.resolve()
        }
        onOpenChange={close("delete")}
        open={dialog?.kind === "delete"}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title={dialog?.kind === "delete" ? `Delete ${dialog.group.name}?` : ""}
      />
    </SettingsEmptyArtScope>
  );
}

type SectionProps = {
  settings: DirectorySync;
  readOnly: boolean;
  onDialog: (dialog: Dialog) => void;
};

function ConnectionSection({ settings, readOnly, onDialog }: SectionProps) {
  const { token, license } = settings;
  const expired = settings.reason === "license_expired";
  const actions = useDirectorySyncActions();
  const [error, setError] = useState<unknown>(null);
  const [generating, setGenerating] = useState(false);
  return (
    <SettingsSection
      description={
        expired && license
          ? `Your license expired on ${formatDate(license.graceEndsAt)}, so directory sync has stopped. People and groups stay as they were last synced until the license is renewed.`
          : "Your identity provider sends people and groups to this SCIM endpoint."
      }
      title="Connection"
    >
      <SettingsRows>
        <CopyRow disabled={expired} label="Base URL" value={settings.baseUrl} />
        {token ? (
          <SettingsRow
            description={[
              `Created ${formatDate(token.createdAt)}${token.createdBy ? ` by ${token.createdBy.name}` : ""}`,
              token.lastUsedAt
                ? `Last used ${formatRelative(token.lastUsedAt)}`
                : "Never used",
            ].join(" · ")}
            label="Bearer token"
            value={<Mono>{`scim_••••••••${token.last4 ?? ""}`}</Mono>}
          >
            {readOnly ? null : (
              <SettingsRowMenu
                actions={[
                  {
                    label: "Regenerate",
                    onSelect: () => onDialog({ kind: "regenerate" }),
                  },
                  {
                    label: "Revoke",
                    onSelect: () => onDialog({ kind: "revoke" }),
                  },
                ]}
                label="Token actions"
              />
            )}
          </SettingsRow>
        ) : (
          <SettingsRow
            description="Your identity provider sends it with every request."
            label="Bearer token"
            value={
              <span className="text-body text-muted-foreground">None yet</span>
            }
          >
            {readOnly ? null : (
              <Button
                aria-busy={generating || undefined}
                onClick={() => {
                  if (generating) return;
                  setError(null);
                  setGenerating(true);
                  actions
                    .generate()
                    .then((issued) =>
                      onDialog({ kind: "token", secret: issued.token }),
                    )
                    .catch(setError)
                    .finally(() => setGenerating(false));
                }}
                size="compact"
                type="button"
                variant="secondary"
              >
                <span className="grid place-items-center">
                  <span
                    className={cn(
                      "col-start-1 row-start-1",
                      generating && "invisible",
                    )}
                  >
                    Generate token
                  </span>
                  {generating ? (
                    <Spinner className="col-start-1 row-start-1 size-3.5" />
                  ) : null}
                </span>
              </Button>
            )}
          </SettingsRow>
        )}
      </SettingsRows>
      <ErrorLine error={error} fallback="Something went wrong. Try again." />
    </SettingsSection>
  );
}

function syncedDescription(settings: DirectorySync) {
  if (settings.sync.running)
    return "Receiving changes from your identity provider…";
  if (!settings.lastSyncAt) return undefined;
  const removed = settings.groups.filter((group) => group.removedAt).length;
  const synced = settings.groups.length - removed;
  const when =
    settings.reason === "license_expired"
      ? formatDate(settings.lastSyncAt)
      : formatRelative(settings.lastSyncAt);
  return [
    `Last synced ${when}`,
    [
      count(settings.sync.people.synced, "person", "people"),
      count(synced, "group", "groups"),
      ...(removed ? [`${removed} removed`] : []),
    ].join(", "),
  ].join(" · ");
}

function removedCaption(group: ScimGroup) {
  return [
    `Removed in your identity provider on ${dayMonth(group.removedAt ?? "")}.`,
    group.removedMembers
      ? `Its ${count(group.removedMembers, "person", "people")} lost the access it gave.`
      : null,
    group.agents
      ? `${count(group.agents, "agent", "agents")} still ${group.agents === 1 ? "names" : "name"} it.`
      : "No agents name it.",
  ]
    .filter(Boolean)
    .join(" ");
}

function Chevron() {
  return (
    <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
  );
}

function RowLink({
  children,
  ...link
}: { children: ReactNode } & (
  | { to: "/settings/organization/members" }
  | {
      to: "/settings/organization/groups/$groupId";
      params: { groupId: string };
    }
)) {
  return (
    <Link
      className="block transition-colors hover:bg-muted/50"
      viewTransition={PAGE_FORWARD}
      {...link}
    >
      {children}
    </Link>
  );
}

function SyncedSection({ settings, readOnly, onDialog }: SectionProps) {
  const { sync } = settings;
  // A group that agents still name can't go; say which deployments instead
  // of offering a delete the API refuses.
  const askToDelete = async (group: ScimGroup) => {
    const namedBy = group.agents
      ? await namingDeployments(group.id).catch(() => [])
      : [];
    onDialog(
      namedBy.length
        ? { kind: "refused", group, namedBy }
        : { kind: "delete", group },
    );
  };
  const never = !settings.lastSyncAt && !sync.running;
  const removed = settings.groups
    .filter((group) => group.removedAt)
    .sort((a, b) => (b.removedAt ?? "").localeCompare(a.removedAt ?? ""));
  const current = settings.groups.filter((group) => !group.removedAt);
  return (
    <SettingsSection
      actions={
        sync.running ? (
          <span className="flex items-center gap-2 text-caption text-muted-foreground">
            <Spinner className="size-3.5" />
            Syncing
          </span>
        ) : undefined
      }
      description={syncedDescription(settings)}
      title="Synced from your identity provider"
    >
      {never ? (
        <SettingsEmpty
          art={<DirectorySyncArt />}
          description="Add the base URL and token to your identity provider's SCIM settings, then assign people and groups to the app."
          title="Nothing synced yet"
        />
      ) : (
        <SettingsRows>
          <RowLink to="/settings/organization/members">
            <SettingsRow
              description={
                sync.running
                  ? `${sync.received ?? 0} received so far`
                  : `${sync.people.synced} synced · ${sync.people.deactivated} deactivated in your identity provider`
              }
              label="People"
            >
              <Chevron />
            </SettingsRow>
          </RowLink>
          {removed.map((group) => (
            <SettingsRow
              description={removedCaption(group)}
              key={group.id}
              label={
                <Labelled
                  badge={<Dot color="amber">Removed</Dot>}
                  label={group.name}
                />
              }
            >
              <Button asChild size="compact" variant="secondary">
                <Link
                  params={{ groupId: group.id }}
                  to="/settings/organization/groups/$groupId"
                  viewTransition={PAGE_FORWARD}
                >
                  Review
                </Link>
              </Button>
              {readOnly ? null : (
                <SettingsRowMenu
                  actions={[
                    {
                      label: "Delete group",
                      onSelect: () => void askToDelete(group),
                    },
                  ]}
                  label={`${group.name} actions`}
                />
              )}
            </SettingsRow>
          ))}
          {current.map((group) => (
            <RowLink
              key={group.id}
              params={{ groupId: group.id }}
              to="/settings/organization/groups/$groupId"
            >
              <SettingsRow
                description={`Group · ${count(group.memberCount, "person", "people")}`}
                label={group.name}
              >
                <Chevron />
              </SettingsRow>
            </RowLink>
          ))}
        </SettingsRows>
      )}
    </SettingsSection>
  );
}
