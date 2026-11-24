"use client";

// Organization members and pending invitations. Owners and Admins invite
// people, change roles and remove members; everyone else sees the list.

import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@preprocess/ui/components/table";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { OpenRectArrowOut, Pencil, Redo3, X } from "@preprocess/ui/lib/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";

import { useAuth, useOrganizationId } from "../auth/auth-context";
import { apiFetch, authPost, orgApi } from "../auth/client";
import {
  SettingsAvatar,
  SettingsCard,
  SettingsConfirmDialog,
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsError,
  type SettingsMenuAction,
  SettingsPanelMessage,
  SettingsReveal,
  SettingsRowMenu,
  SkeletonButton,
  SkeletonCircle,
  SkeletonLine,
  actionErrorMessage,
  formatDate,
} from "./kit";

type Role = "owner" | "admin" | "member";

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

type Organization = {
  members: {
    id: string;
    userId: string;
    role: Role;
    createdAt: string;
    user: { name: string; email: string; image?: string | null };
  }[];
  invitations: {
    id: string;
    email: string;
    role: Role;
    status: "pending" | "accepted" | "rejected" | "canceled";
    expiresAt: string;
  }[];
};

type MemberGroups = { userId: string; groups: { name: string }[] }[];

type Row =
  | {
      kind: "member";
      id: string;
      userId: string;
      name: string;
      email: string;
      image: string | null;
      role: Role;
      groups: string[];
      since: string;
    }
  | {
      kind: "invitation";
      id: string;
      email: string;
      role: Role;
      expired: boolean;
      expiresAt: string;
    };

type Dialog =
  | { kind: "invite" }
  | { kind: "role"; row: Extract<Row, { kind: "member" }> }
  | { kind: "remove"; row: Extract<Row, { kind: "member" }> }
  | { kind: "revoke"; row: Extract<Row, { kind: "invitation" }> };

function useMembers(organizationId: string) {
  return useQuery({
    queryKey: ["members", organizationId],
    queryFn: async (): Promise<Row[]> => {
      const [organization, groups] = await Promise.all([
        apiFetch<Organization>(
          `/api/auth/organization/get-full-organization?organizationId=${organizationId}`,
        ),
        orgApi<MemberGroups>(organizationId, "/members"),
      ]);
      const groupsOf = new Map(
        groups.map((member) => [
          member.userId,
          member.groups.map((group) => group.name),
        ]),
      );
      const members: Row[] = organization.members
        .map((member) => ({
          kind: "member" as const,
          id: member.id,
          userId: member.userId,
          name: member.user.name,
          email: member.user.email,
          image: member.user.image ?? null,
          role: member.role,
          groups: groupsOf.get(member.userId) ?? [],
          since: member.createdAt,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
      const invitations: Row[] = organization.invitations
        .filter((invitation) => invitation.status === "pending")
        .map((invitation) => ({
          kind: "invitation" as const,
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expired: new Date(invitation.expiresAt).getTime() < Date.now(),
          expiresAt: invitation.expiresAt,
        }));
      return [...members, ...invitations];
    },
  });
}

function RoleSelect({
  value,
  onChange,
  allowOwner,
  disabled,
}: {
  value: Role;
  onChange: (role: Role) => void;
  allowOwner: boolean;
  disabled?: boolean;
}) {
  const roles: Role[] = allowOwner
    ? ["member", "admin", "owner"]
    : ["member", "admin"];
  return (
    <Select
      disabled={disabled}
      onValueChange={(next) => onChange(next as Role)}
      value={value}
    >
      <SelectTrigger aria-label="Role" placeholder="Role" />
      <SelectContent>
        {roles.map((role, index) => (
          <SelectItem index={index} key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function validateEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? null
    : "Enter an email address, like ada@example.com.";
}

function InviteDialog({
  open,
  onOpenChange,
  organizationId,
  allowOwner,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  allowOwner: boolean;
  onInvited: () => Promise<unknown>;
}) {
  const emailRef = useRef<InlineValidationHandle>(null);
  const sendRef = useRef<LoadingButtonHandle>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSend() {
    setError(null);
    if (!emailRef.current?.commit()) throw new AsyncActionAbortError();
    try {
      await authPost("/organization/invite-member", {
        organizationId,
        email: email.trim(),
        role,
      });
      await onInvited();
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not send the invitation."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description="They get an email with a link to join this organization."
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) {
          setEmail("");
          setRole("member");
          setError(null);
        }
        onOpenChange(next);
      }}
      open={open}
      title="Invite someone"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          sendRef.current?.run();
        }}
      >
        <InlineValidation
          ref={emailRef}
          autoComplete="off"
          autoFocus
          disabled={pending}
          hint="The address they'll sign up with."
          id="invite-email"
          label="Email"
          onChange={setEmail}
          placeholder="ada@example.com"
          type="email"
          validate={validateEmail}
          value={email}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Role</span>
          <RoleSelect
            allowOwner={allowOwner}
            disabled={pending}
            onChange={setRole}
            value={role}
          />
        </div>
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
        <SettingsDialogActions
          onCancel={() => onOpenChange(false)}
          pending={pending}
        >
          <LoadingButton
            ref={sendRef}
            onAction={onSend}
            onStatusChange={(status) => {
              setPending(status === "pending");
              if (status === "success")
                window.setTimeout(() => onOpenChange(false), 600);
            }}
            pendingLabel="Sending…"
            successLabel="Sent"
            type="submit"
          >
            Send invitation
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}

function ChangeRoleDialog({
  row,
  onOpenChange,
  organizationId,
  allowOwner,
  onChanged,
}: {
  row: Extract<Row, { kind: "member" }> | null;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  allowOwner: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [role, setRole] = useState<Role>(row?.role ?? "member");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState(row);
  if (row && row !== shown) {
    setShown(row);
    setRole(row.role);
    setError(null);
  }

  return (
    <SettingsDialogShell
      description={
        row ? `What ${row.name} can do in this organization.` : undefined
      }
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      open={row !== null}
      title="Change role"
    >
      <div className="flex flex-col gap-4">
        <RoleSelect
          allowOwner={allowOwner}
          disabled={pending}
          onChange={setRole}
          value={role}
        />
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
        <SettingsDialogActions
          onCancel={() => onOpenChange(false)}
          pending={pending}
        >
          <LoadingButton
            onAction={async () => {
              if (!row) return;
              setError(null);
              try {
                await authPost("/organization/update-member-role", {
                  organizationId,
                  memberId: row.id,
                  role,
                });
                await onChanged();
              } catch (cause) {
                setError(
                  actionErrorMessage(cause, "Could not change the role."),
                );
                throw cause;
              }
            }}
            onStatusChange={(status) => {
              setPending(status === "pending");
              if (status === "success")
                window.setTimeout(() => onOpenChange(false), 600);
            }}
            pendingLabel="Saving…"
            successLabel="Saved"
          >
            Save
          </LoadingButton>
        </SettingsDialogActions>
      </div>
    </SettingsDialogShell>
  );
}

function RowBadge({ row, self }: { row: Row; self: boolean }) {
  if (self) return <Badge color="gray">You</Badge>;
  if (row.kind === "member") return null;
  return row.expired ? (
    <Badge color="red">
      <span className="sr-only">Status: Invitation </span>Expired
    </Badge>
  ) : (
    <Badge color="amber">
      <span className="sr-only">Status: </span>Invited
    </Badge>
  );
}

function rowActions(
  row: Row,
  callerRole: Role,
  self: boolean,
  open: (dialog: Dialog) => void,
  resend: (row: Extract<Row, { kind: "invitation" }>) => void,
): SettingsMenuAction[] {
  if (callerRole === "member" || self) return [];
  if (row.kind === "invitation") {
    return [
      { label: "Resend invitation", icon: Redo3, onSelect: () => resend(row) },
      {
        label: "Revoke invitation",
        icon: X,
        onSelect: () => open({ kind: "revoke", row }),
      },
    ];
  }
  // Only an Owner can change or remove another Owner.
  if (row.role === "owner" && callerRole !== "owner") return [];
  return [
    {
      label: "Change role",
      icon: Pencil,
      onSelect: () => open({ kind: "role", row }),
    },
    {
      label: "Remove from organization",
      icon: OpenRectArrowOut,
      onSelect: () => open({ kind: "remove", row }),
    },
  ];
}

function MembersSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <SkeletonButton width={96} />
      </div>
      <SettingsCard table>
        <Table>
          <MembersHeader />
          <TableBody>
            {Array.from({ length: 3 }, (_, index) => (
              <TableRow key={index}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <SkeletonCircle />
                    <div className="flex flex-col">
                      <SkeletonLine width={140} />
                      <SkeletonLine role="caption" width={180} />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <SkeletonLine width={64} />
                </TableCell>
                <TableCell>
                  <SkeletonLine width={96} />
                </TableCell>
                <TableCell />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SettingsCard>
    </div>
  );
}

function MembersHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Person</TableHead>
        <TableHead className="w-28">Role</TableHead>
        <TableHead className="w-44">Groups</TableHead>
        <TableHead className="w-10">
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

export function MembersPanel() {
  const organizationId = useOrganizationId();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const members = useMembers(organizationId);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [resendError, setResendError] = useState<unknown>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["members", organizationId] });

  if (members.isError) return <SettingsError error={members.error} />;

  const rows = members.data;
  const callerRole =
    rows?.find((row) => row.kind === "member" && row.userId === user?.id)
      ?.role ?? "member";
  const canManage = callerRole !== "member";

  async function resend(row: Extract<Row, { kind: "invitation" }>) {
    setResendError(null);
    try {
      await authPost("/organization/invite-member", {
        organizationId,
        email: row.email,
        role: row.role,
        resend: true,
      });
      await refresh();
    } catch (cause) {
      setResendError(cause);
    }
  }

  return (
    <SettingsReveal data={rows} skeleton={<MembersSkeleton />}>
      {(rows) => (
        <div className="flex flex-col gap-3" data-testid="members-panel">
          {canManage ? (
            <div className="flex justify-end">
              <Button
                onClick={() => setDialog({ kind: "invite" })}
                type="button"
              >
                Invite people
              </Button>
            </div>
          ) : null}
          {resendError ? <SettingsError error={resendError} /> : null}
          <SettingsCard table>
            <Table>
              <MembersHeader />
              <TableBody>
                {rows.map((row, index) => {
                  const self = row.kind === "member" && row.userId === user?.id;
                  const name = row.kind === "member" ? row.name : row.email;
                  const actions = rowActions(
                    row,
                    callerRole,
                    self,
                    setDialog,
                    (invitation) => void resend(invitation),
                  );
                  return (
                    <TableRow index={index} key={row.id}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <SettingsAvatar
                            name={name}
                            pictureUrl={
                              row.kind === "member" ? row.image : null
                            }
                          />
                          <div className="flex min-w-0 flex-col">
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className="truncate text-body text-foreground"
                                style={{
                                  fontVariationSettings: fontWeights.semibold,
                                }}
                                title={name}
                              >
                                {name}
                              </span>
                              <RowBadge row={row} self={self} />
                            </div>
                            <span className="truncate text-caption text-muted-foreground">
                              {row.kind === "member"
                                ? row.email
                                : `Invitation expires ${formatDate(row.expiresAt)}`}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{ROLE_LABELS[row.role]}</TableCell>
                      <TableCell>
                        {row.kind === "member" && row.groups.length > 0 ? (
                          <span
                            className="truncate text-foreground"
                            title={row.groups.join(", ")}
                          >
                            {row.groups.join(", ")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            <span className="sr-only">No groups</span>
                            <span aria-hidden="true">—</span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="w-10 text-right">
                        {actions.length > 0 ? (
                          <SettingsRowMenu actions={actions} label="Actions" />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </SettingsCard>

          <InviteDialog
            allowOwner={callerRole === "owner"}
            onInvited={refresh}
            onOpenChange={(open) => setDialog(open ? { kind: "invite" } : null)}
            open={dialog?.kind === "invite"}
            organizationId={organizationId}
          />
          <ChangeRoleDialog
            allowOwner={callerRole === "owner"}
            onChanged={refresh}
            onOpenChange={(open) => {
              if (!open) setDialog(null);
            }}
            organizationId={organizationId}
            row={dialog?.kind === "role" ? dialog.row : null}
          />
          <SettingsConfirmDialog
            confirmLabel="Remove"
            description={
              dialog?.kind === "remove"
                ? `${dialog.row.name} loses access to this organization and leaves its groups.`
                : undefined
            }
            onConfirm={async () => {
              if (dialog?.kind !== "remove") return;
              await authPost("/organization/remove-member", {
                organizationId,
                memberIdOrEmail: dialog.row.id,
              });
              await refresh();
            }}
            onOpenChange={(open) => {
              if (!open) setDialog(null);
            }}
            open={dialog?.kind === "remove"}
            pendingLabel="Removing…"
            successLabel="Removed"
            title="Remove from organization?"
          />
          <SettingsConfirmDialog
            confirmLabel="Revoke"
            description={
              dialog?.kind === "revoke"
                ? `The link sent to ${dialog.row.email} stops working.`
                : undefined
            }
            onConfirm={async () => {
              if (dialog?.kind !== "revoke") return;
              await authPost("/organization/cancel-invitation", {
                invitationId: dialog.row.id,
              });
              await refresh();
            }}
            onOpenChange={(open) => {
              if (!open) setDialog(null);
            }}
            open={dialog?.kind === "revoke"}
            pendingLabel="Revoking…"
            successLabel="Revoked"
            title="Revoke invitation?"
          />
        </div>
      )}
    </SettingsReveal>
  );
}
