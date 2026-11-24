"use client";

// Member dialogs, ported from the WorkOS users-management widget
// (invite-user-dialog, edit-user-role-dialog, delete-user-dialog,
// resend-invite-dialog, revoke-invite-dialog): same flows and copy, on the
// Fluid settings kit.

import { Button } from "@preprocess/ui/components/button";
import {
  CheckboxGroup,
  CheckboxItem,
} from "@preprocess/ui/components/checkbox-group";
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
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useWorkOsSdk, workOsKey } from "../../workos-client-api/sdk";
import type {
  InviteUserMutation,
  ListOrganizationMembershipsQuery,
  ListRolesQuery,
  RemoveMemberMutation,
  ResendInvitationMutation,
  RevokeInvitationMutation,
  UpdateMemberRoleMutation,
} from "../../workos-client-api/vendor/generated";
import {
  SettingsConfirmDialog,
  SettingsDialogShell,
  SettingsError,
} from "../kit";
import { validateEmail } from "../settings-elevated";

export type Member =
  ListOrganizationMembershipsQuery["organizationMemberships"]["data"][number];
export type RolesAndConfig = ListRolesQuery["roles"];
export type Role = RolesAndConfig["roles"][number];

export type MemberDialog =
  | { kind: "invite" }
  | { kind: "edit-role"; member: Member }
  | { kind: "remove"; member: Member }
  | { kind: "resend"; member: Member }
  | { kind: "revoke"; member: Member };

export const SINGLE_ROLE_MESSAGE =
  "You cannot update the role for this user as there is only one role available.";

// Failure members, worded as the widget's users-management-utils.
function unwrapInviteUser(result: InviteUserMutation["inviteUser"]) {
  switch (result.__typename) {
    case "UserInvited":
      return result.invitation;
    case "InviteeAlreadyMember":
      throw new Error("User already exists");
    case "InviteeAlreadyInvited":
      throw new Error("User already invited");
    case "InvalidInviteeEmail":
    case "InviteeEmailNotDeliverable":
      throw new Error("Invalid email");
    case "InvalidInviteeRole":
      throw new Error("Invalid role");
    case "InvalidInvitationExpiry":
      throw new Error("Invalid input");
    case "OrganizationBlockedFromSendingInvites":
      throw new Error("This organization is not allowed to send invites.");
  }
}

function unwrapUpdateMemberRole(
  result: UpdateMemberRoleMutation["updateMemberRole"],
) {
  switch (result.__typename) {
    case "MemberRoleUpdated":
      return result.member;
    case "MemberNotFound":
      throw new Error("Cannot edit role for user");
    case "RoleNotFound":
      throw new Error("Invalid role");
  }
}

function unwrapRemoveMember(result: RemoveMemberMutation["removeMember"]) {
  switch (result.__typename) {
    case "MemberRemoved":
      return result;
    case "MemberNotFound":
    case "MemberIsManagedByDirectory":
      throw new Error("Cannot revoke membership");
  }
}

function unwrapResendInvitation(
  result: ResendInvitationMutation["resendInvitation"],
) {
  switch (result.__typename) {
    case "InvitationResent":
      return result.invitation;
    case "ResendInvitationNotFound":
      throw new Error("User not invited");
    case "InviteeAlreadyAccepted":
      throw new Error("User already accepted invite");
    case "InviteeEmailNotDeliverable":
      throw new Error("Invalid email");
  }
}

function unwrapRevokeInvitation(
  result: RevokeInvitationMutation["revokeInvitation"],
) {
  switch (result.__typename) {
    case "InvitationRevoked":
      return result.invitation;
    case "InvitationNotFound":
      throw new Error("User not invited");
    case "InvitationNotPending":
      throw new Error("User already accepted invite");
  }
}

export function memberName(member: Member) {
  return [member.firstName, member.lastName].filter(Boolean).join(" ");
}

function useInvalidateMembers() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: workOsKey("ListOrganizationMemberships"),
    });
}

function defaultRoleSlug(roles: readonly Role[]) {
  return roles.find((role) => role.isDefault)?.slug ?? roles[0]?.slug ?? "";
}

function RoleSelect({
  roles,
  value,
  onChange,
  disabled,
}: {
  roles: readonly Role[];
  value: string;
  onChange: (slug: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select disabled={disabled} onValueChange={onChange} value={value}>
      <SelectTrigger aria-label="Role" placeholder="Select a role" />
      <SelectContent>
        {roles.map((role, index) => (
          <SelectItem index={index} key={role.slug} value={role.slug}>
            {role.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <span className="text-caption text-muted-foreground">{children}</span>;
}

function InviteUserDialog({
  open,
  onOpenChange,
  rolesAndConfig,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rolesAndConfig: RolesAndConfig | undefined;
}) {
  const sdk = useWorkOsSdk();
  const invalidate = useInvalidateMembers();
  const roles = rolesAndConfig?.roles ?? [];
  const emailRef = useRef<InlineValidationHandle>(null);
  const inviteRef = useRef<LoadingButtonHandle>(null);
  const [email, setEmail] = useState("");
  const [roleSlug, setRoleSlug] = useState(defaultRoleSlug(roles));
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!roleSlug && roles.length > 0) setRoleSlug(defaultRoleSlug(roles));
  }, [roleSlug, roles]);

  const onlyRole = roles.length === 1 ? roles[0] : undefined;

  return (
    <SettingsDialogShell
      description="An invitation will be sent to this email address with a link to complete their account."
      onOpenChange={onOpenChange}
      open={open}
      title="Invite user"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          inviteRef.current?.run();
        }}
      >
        <InlineValidation
          ref={emailRef}
          autoComplete="off"
          autoFocus
          id="invite-user-email"
          label="Email address"
          name="email"
          onChange={setEmail}
          placeholder="Enter an email address"
          type="email"
          validate={validateEmail}
          value={email}
        />
        {roles.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Role</FieldLabel>
            <RoleSelect
              disabled={roles.length <= 1}
              onChange={setRoleSlug}
              roles={roles}
              value={roleSlug}
            />
            {onlyRole ? (
              <p className="text-caption text-muted-foreground">
                New users will be invited with the {onlyRole.name} role, as it
                is the only one available.
              </p>
            ) : null}
          </div>
        ) : null}
        {error ? <SettingsError error={error} /> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <LoadingButton
            ref={inviteRef}
            onAction={async () => {
              if (!emailRef.current?.commit()) {
                throw new AsyncActionAbortError();
              }
              setError(null);
              const data = await sdk.InviteUser({
                input: {
                  email: email.trim(),
                  roleSlug: roleSlug || undefined,
                },
              });
              unwrapInviteUser(data.inviteUser);
              await invalidate();
            }}
            onError={setError}
            onStatusChange={(status) => {
              if (status === "success") {
                window.setTimeout(() => onOpenChange(false), 600);
              }
            }}
            pendingLabel="Inviting…"
            successLabel="Invited"
            type="submit"
          >
            Invite
          </LoadingButton>
        </div>
      </form>
    </SettingsDialogShell>
  );
}

function EditRoleDialog({
  member,
  open,
  onOpenChange,
  rolesAndConfig,
}: {
  member: Member;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rolesAndConfig: RolesAndConfig | undefined;
}) {
  const sdk = useWorkOsSdk();
  const invalidate = useInvalidateMembers();
  const roles = rolesAndConfig?.roles ?? [];
  const multiple = rolesAndConfig?.multipleRolesEnabled ?? false;
  const [selected, setSelected] = useState<string[]>(() =>
    member.roles.map((role) => role.slug),
  );
  const [error, setError] = useState<unknown>(null);
  const displayName = memberName(member) || member.email;
  const singleRole = roles.length === 1;

  const checkedIndices = new Set(
    roles.flatMap((role, index) =>
      selected.includes(role.slug) ? [index] : [],
    ),
  );

  return (
    <SettingsDialogShell
      description={
        multiple
          ? `Select the roles to assign to ${displayName}`
          : `Select the role to assign to ${displayName}`
      }
      footer={
        <>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <LoadingButton
            disabled={singleRole || selected.length === 0}
            onAction={async () => {
              setError(null);
              const data = await sdk.UpdateMemberRole({
                input: { userId: member.id, roleSlugs: selected },
              });
              unwrapUpdateMemberRole(data.updateMemberRole);
              await invalidate();
            }}
            onError={setError}
            onStatusChange={(status) => {
              if (status === "success") {
                window.setTimeout(() => onOpenChange(false), 600);
              }
            }}
            pendingLabel="Saving…"
            successLabel="Saved"
          >
            Save
          </LoadingButton>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title={multiple ? "Edit roles" : "Edit role"}
    >
      <div className="flex flex-col gap-3">
        {multiple ? (
          <CheckboxGroup aria-label="Roles" checkedIndices={checkedIndices}>
            {roles.map((role, index) => (
              <CheckboxItem
                checked={selected.includes(role.slug)}
                index={index}
                key={role.slug}
                label={role.name}
                onToggle={() =>
                  setSelected((current) =>
                    current.includes(role.slug)
                      ? current.filter((slug) => slug !== role.slug)
                      : [...current, role.slug],
                  )
                }
              />
            ))}
          </CheckboxGroup>
        ) : (
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Assign a role</FieldLabel>
            <RoleSelect
              disabled={singleRole}
              onChange={(slug) => setSelected([slug])}
              roles={roles}
              value={selected[0] ?? ""}
            />
          </div>
        )}
        {singleRole ? (
          <p className="text-caption text-muted-foreground">
            {SINGLE_ROLE_MESSAGE}
          </p>
        ) : null}
        {error ? <SettingsError error={error} /> : null}
      </div>
    </SettingsDialogShell>
  );
}

/** The dialog for whichever member action is open. */
export function MemberDialogs({
  dialog,
  onClose,
  rolesAndConfig,
}: {
  dialog: MemberDialog | null;
  onClose: () => void;
  rolesAndConfig: RolesAndConfig | undefined;
}) {
  const sdk = useWorkOsSdk();
  const invalidate = useInvalidateMembers();
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  if (!dialog) return null;

  switch (dialog.kind) {
    case "invite":
      return (
        <InviteUserDialog
          onOpenChange={onOpenChange}
          open
          rolesAndConfig={rolesAndConfig}
        />
      );
    case "edit-role":
      return (
        <EditRoleDialog
          key={dialog.member.id}
          member={dialog.member}
          onOpenChange={onOpenChange}
          open
          rolesAndConfig={rolesAndConfig}
        />
      );
    case "remove":
      return (
        <SettingsConfirmDialog
          confirmLabel="Remove"
          description={`Are you sure you want to remove ${dialog.member.email}? This action is immediate and cannot be undone.`}
          onConfirm={async () => {
            const data = await sdk.RemoveMember({
              input: { userId: dialog.member.id },
            });
            unwrapRemoveMember(data.removeMember);
            await invalidate();
          }}
          onOpenChange={onOpenChange}
          open
          pendingLabel="Removing…"
          successLabel="Removed"
          title="Remove user"
        />
      );
    case "resend":
      return (
        <SettingsConfirmDialog
          confirmLabel="Resend"
          description={`Are you sure you want to resend the invite to ${dialog.member.email}?`}
          onConfirm={async () => {
            const data = await sdk.ResendInvitation({
              input: { userId: dialog.member.id },
            });
            unwrapResendInvitation(data.resendInvitation);
            await invalidate();
          }}
          onOpenChange={onOpenChange}
          open
          pendingLabel="Sending…"
          successLabel="Invite sent"
          title="Resend invite?"
        />
      );
    case "revoke":
      return (
        <SettingsConfirmDialog
          confirmLabel="Revoke"
          description={`Are you sure you want to revoke the invite to ${dialog.member.email}? This action is immediate and cannot be undone.`}
          onConfirm={async () => {
            const data = await sdk.RevokeInvitation({
              input: { userId: dialog.member.id },
            });
            unwrapRevokeInvitation(data.revokeInvitation);
            await invalidate();
          }}
          onOpenChange={onOpenChange}
          open
          pendingLabel="Revoking…"
          successLabel="Revoked"
          title="Revoke invite?"
        />
      );
  }
}
