"use client";

// Organization members, ported from the WorkOS users-management widget:
// search by name or email, filter by role, paginate by cursor, and act on a
// member (edit roles, resend or revoke an invite, remove) from the row menu.

import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
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
import { cn } from "@preprocess/ui/lib/utils";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useWorkOsQuery, workOsKey } from "../workos-client-api/sdk";
import {
  formatRelative,
  SettingsAvatar,
  SettingsCard,
  SettingsError,
  type SettingsMenuAction,
  SettingsReveal,
  SettingsRowMenu,
  SettingsSearchField,
  SkeletonButton,
  SkeletonCircle,
  SkeletonField,
  SkeletonLine,
} from "./kit";
import {
  MemberDialogs,
  memberName,
  type Member,
  type MemberDialog,
  type RolesAndConfig,
} from "./members/member-dialogs";

// The widget's USER_ROW_LIMIT.
const USER_ROW_LIMIT = 10;
const ALL_ROLES = "all";

type Cursor = { before: string | null; after: string | null };

function useDebounced(value: string, wait: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), wait);
    return () => window.clearTimeout(timeout);
  }, [value, wait]);
  return debounced;
}

function MemberBadge({ member }: { member: Member }) {
  if (member.isCurrentUser) return <Badge color="gray">You</Badge>;
  switch (member.status) {
    case "Invited":
      return (
        <Badge color="amber">
          <span className="sr-only">Status: </span>Invited
        </Badge>
      );
    case "InviteExpired":
      return (
        <Badge color="red">
          <span className="sr-only">Status: Invite </span>Expired
        </Badge>
      );
    case "InviteRevoked":
      return (
        <Badge color="red">
          <span className="sr-only">Status: Invite </span>Revoked
        </Badge>
      );
    default:
      return null;
  }
}

function RolesCell({ member, dim }: { member: Member; dim: boolean }) {
  const names = member.roles.map((role) => role.name);
  if (names.length === 0) {
    return (
      <span className="text-muted-foreground">
        <span className="sr-only">No roles assigned</span>
        <span aria-hidden="true">—</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "truncate",
        dim ? "text-muted-foreground" : "text-foreground",
      )}
      title={names.join(", ")}
    >
      {names.length > 2 ? `${names.length} roles` : names.join(", ")}
    </span>
  );
}

function LastActive({ member }: { member: Member }) {
  if (!member.lastActivityAt) {
    return (
      <span className="text-muted-foreground">
        <span className="sr-only">
          {member.status === "Active" ? "Never" : "Not active"}
        </span>
        <span aria-hidden="true">—</span>
      </span>
    );
  }
  return (
    <time
      className="text-muted-foreground"
      dateTime={member.lastActivityAt}
      title={new Date(member.lastActivityAt).toLocaleString()}
    >
      {formatRelative(member.lastActivityAt)}
    </time>
  );
}

function memberActions(
  member: Member,
  rolesAndConfig: RolesAndConfig | undefined,
  open: (dialog: MemberDialog) => void,
): SettingsMenuAction[] {
  const actions = new Set(member.actions);
  const items: SettingsMenuAction[] = [];
  if (actions.has("EditRole")) {
    items.push({
      label: rolesAndConfig?.multipleRolesEnabled ? "Edit roles" : "Edit role",
      icon: Pencil,
      // One role means nothing to change (the widget disables it too).
      disabled: !rolesAndConfig || rolesAndConfig.roles.length <= 1,
      onSelect: () => open({ kind: "edit-role", member }),
    });
  }
  if (actions.has("ResendInvite")) {
    items.push({
      label: "Resend invitation",
      icon: Redo3,
      onSelect: () => open({ kind: "resend", member }),
    });
  }
  if (actions.has("RevokeInvite")) {
    items.push({
      label: "Revoke invitation",
      icon: X,
      onSelect: () => open({ kind: "revoke", member }),
    });
  }
  if (actions.has("RevokeMembership")) {
    items.push({
      label: "Remove user",
      icon: OpenRectArrowOut,
      onSelect: () => open({ kind: "remove", member }),
    });
  }
  return items;
}

function MemberRow({
  index,
  member,
  rolesAndConfig,
  onOpen,
}: {
  index: number;
  member: Member;
  rolesAndConfig: RolesAndConfig | undefined;
  onOpen: (dialog: MemberDialog) => void;
}) {
  const name = memberName(member);
  const dim =
    member.status === "InviteRevoked" || member.status === "InviteExpired";
  const actions = memberActions(member, rolesAndConfig, onOpen);

  return (
    <TableRow index={index}>
      <TableCell>
        <div
          className={cn("flex min-w-0 items-center gap-3", dim && "opacity-60")}
        >
          <SettingsAvatar
            name={name || member.email}
            pictureUrl={member.profilePictureUrl}
          />
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="truncate text-body text-foreground"
                style={{ fontVariationSettings: fontWeights.semibold }}
                title={name || member.email}
              >
                {name || member.email}
              </span>
              <MemberBadge member={member} />
            </div>
            {name ? (
              <span
                className="truncate text-caption text-muted-foreground"
                title={member.email}
              >
                {member.email}
              </span>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <RolesCell dim={dim} member={member} />
      </TableCell>
      <TableCell>
        <LastActive member={member} />
      </TableCell>
      <TableCell className="w-10 text-right">
        {actions.length > 0 ? (
          <SettingsRowMenu actions={actions} label="User actions" />
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function SkeletonRows({ multiple }: { multiple: boolean }) {
  return (
    <>
      {Array.from({ length: 4 }, (_, index) => (
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
            <SkeletonLine width={multiple ? 96 : 64} />
          </TableCell>
          <TableCell>
            <SkeletonLine width={88} />
          </TableCell>
          <TableCell>
            <SkeletonButton width={28} />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// First load: the toolbar's controls need roles and members to work, so they
// are skeletons too; the column headers are static and render as themselves.
function MembersSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SkeletonField className="min-w-48 flex-1" />
        <div className="flex shrink-0 items-center gap-2">
          <SkeletonField width={140} />
          <SkeletonButton width={96} />
        </div>
      </div>
      <SettingsCard table>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead className="w-40">Role</TableHead>
              <TableHead className="w-36">Last active</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <SkeletonRows multiple={false} />
          </TableBody>
        </Table>
      </SettingsCard>
    </div>
  );
}

function EmptyRow({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <tr>
      <td className="px-3 py-10 text-center" colSpan={4}>
        {query ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-body text-foreground">
              No users found for query ‘{query}’
            </p>
            <Button onClick={onClear} type="button" variant="secondary">
              Clear search
            </Button>
          </div>
        ) : (
          <p className="text-body text-muted-foreground">No users found</p>
        )}
      </td>
    </tr>
  );
}

export function MembersPanel() {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim(), 200);
  const [role, setRole] = useState(ALL_ROLES);
  const [cursor, setCursor] = useState<Cursor>({ before: null, after: null });
  const [dialog, setDialog] = useState<MemberDialog | null>(null);

  // A new search or filter starts from the first page.
  useEffect(() => {
    setCursor({ before: null, after: null });
  }, [search, role]);

  const rolesQuery = useWorkOsQuery({
    queryKey: workOsKey("ListRoles"),
    queryFn: (sdk) => sdk.ListRoles(),
    select: (data) => data.roles,
  });
  const rolesAndConfig = rolesQuery.data;
  const roles = rolesAndConfig?.roles ?? [];
  const multiple = rolesAndConfig?.multipleRolesEnabled ?? false;

  const variables = {
    after: cursor.after,
    before: cursor.before,
    limit: USER_ROW_LIMIT,
    roleSlug: role === ALL_ROLES ? null : role,
    search: search || null,
  };
  const membersQuery = useWorkOsQuery({
    queryKey: workOsKey("ListOrganizationMemberships", variables),
    queryFn: (sdk) => sdk.ListOrganizationMemberships(variables),
    select: (data) => data.organizationMemberships,
    placeholderData: keepPreviousData,
  });

  if (membersQuery.isError && !membersQuery.data) {
    return <SettingsError error={membersQuery.error} />;
  }

  const page = membersQuery.data;
  const members = page?.data ?? [];
  const before = page?.listMetadata.before ?? null;
  const after = page?.listMetadata.after ?? null;
  const refetching = membersQuery.isPlaceholderData;

  return (
    <SettingsReveal
      data={page && rolesAndConfig ? true : undefined}
      skeleton={<MembersSkeleton />}
    >
      {() => (
        <div className="flex flex-col gap-3" data-testid="members-panel">
          <div className="flex flex-wrap items-center gap-2">
            <SettingsSearchField
              className="min-w-48 flex-1"
              label="User search"
              onChange={setSearchInput}
              placeholder="Search by name or e-mail"
              value={searchInput}
            />
            <div className="flex shrink-0 items-center gap-2">
              <Select
                disabled={roles.length === 0}
                onValueChange={setRole}
                value={role}
              >
                <SelectTrigger aria-label="Filter by role" placeholder="All" />
                <SelectContent>
                  <SelectItem index={0} value={ALL_ROLES}>
                    All
                  </SelectItem>
                  {roles.map((item, index) => (
                    <SelectItem
                      index={index + 1}
                      key={item.slug}
                      value={item.slug}
                    >
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={!rolesAndConfig}
                onClick={() => setDialog({ kind: "invite" })}
                type="button"
              >
                Invite user
              </Button>
            </div>
          </div>

          {membersQuery.isError ? (
            <SettingsError error={membersQuery.error} />
          ) : null}

          <SettingsCard table>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="w-40">
                    {multiple ? "Roles" : "Role"}
                  </TableHead>
                  <TableHead className="w-36">Last active</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody
                className={cn(
                  "transition-opacity duration-200",
                  refetching && members.length > 0 && "opacity-50",
                )}
              >
                {membersQuery.isPending ? (
                  <SkeletonRows multiple={multiple} />
                ) : members.length > 0 ? (
                  members.map((member, index) => (
                    <MemberRow
                      index={index}
                      key={member.id}
                      member={member}
                      onOpen={setDialog}
                      rolesAndConfig={rolesAndConfig}
                    />
                  ))
                ) : (
                  <EmptyRow onClear={() => setSearchInput("")} query={search} />
                )}
              </TableBody>
            </Table>
          </SettingsCard>

          {before || after ? (
            <div className="flex justify-end gap-2">
              <Button
                disabled={!before || refetching}
                onClick={() => before && setCursor({ before, after: null })}
                size="compact"
                type="button"
                variant="secondary"
              >
                Previous
              </Button>
              <Button
                disabled={!after || refetching}
                onClick={() => after && setCursor({ before: null, after })}
                size="compact"
                type="button"
                variant="secondary"
              >
                Next
              </Button>
            </div>
          ) : null}

          <MemberDialogs
            dialog={dialog}
            onClose={() => setDialog(null)}
            rolesAndConfig={rolesAndConfig}
          />
        </div>
      )}
    </SettingsReveal>
  );
}
