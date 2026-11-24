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
  ArrowLeft,
  ChevronRight,
  Plus,
  ShareUpRight,
  Users,
  X,
} from "@preprocess/ui/lib/icons";
import { Link } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import {
  AccessSelect,
  LEVEL_NAME,
  LEVEL_RANK,
  type AccessValue,
} from "../agents/agent-page";
import type { AgentAccessLevel } from "../agents/agent-seed";
import {
  SettingsAvatar,
  SettingsConfirmDialog,
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsEmpty,
  SettingsIconTile,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsSection,
  actionErrorMessage,
} from "../settings/kit";
import {
  SettingsChrome,
  SettingsSectionTabs,
} from "../settings/settings-widgets";
import type {
  GroupAgentAccess,
  GroupDetail,
  GroupSource,
  GroupSummary,
  OrgPerson,
} from "./group-store";

/** Into a group and back out, with transitions.dev's page side-by-side. */
export const PAGE_FORWARD = { types: ["page-forward"] };
export const PAGE_BACK = { types: ["page-back"] };

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function sourceLabel(source: GroupSource) {
  return source.kind === "directory"
    ? `Synced from ${source.provider}: ${source.idpGroups.join(", ")}`
    : "Managed here";
}

// ─── Groups tab ──────────────────────────────────────────────────────────────

/**
 * Every group in the organization: where its members come from and how many
 * agents it reaches. Each row opens the group.
 */
export function GroupsList({
  groups,
  onCreate,
}: Readonly<{
  groups: readonly GroupSummary[];
  onCreate: (name: string) => Promise<{ id: string }>;
}>) {
  const [creating, setCreating] = useState(false);

  return (
    <SettingsSection
      actions={
        <Button
          leadingIcon={Plus}
          onClick={() => setCreating(true)}
          size="compact"
          type="button"
          variant="secondary"
        >
          New group
        </Button>
      }
      description="Groups decide who can see and operate each agent. Groups mapped to your identity provider keep their members in sync on their own."
    >
      {groups.length === 0 ? (
        <SettingsEmpty
          description="Create a group, or map groups from your identity provider in Authentication."
          title="No groups yet"
        />
      ) : (
        <SettingsRows>
          {groups.map((group) => (
            <Link
              className="block transition-colors hover:bg-muted/50"
              key={group.id}
              params={{ groupId: group.id }}
              to="/settings/organization/groups/$groupId"
              viewTransition={PAGE_FORWARD}
            >
              <SettingsRow
                description={`${plural(group.memberCount, "member", "members")} · ${sourceLabel(group.source)}`}
                label={group.name}
                leading={<SettingsIconTile icon={Users} />}
              >
                <Badge color="gray" size="sm">
                  {group.managesAgents
                    ? "Manages all agents"
                    : plural(group.agentCount, "agent", "agents")}
                </Badge>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
              </SettingsRow>
            </Link>
          ))}
        </SettingsRows>
      )}
      <CreateGroupDialog
        onCreate={onCreate}
        onOpenChange={setCreating}
        open={creating}
      />
    </SettingsSection>
  );
}

function CreateGroupDialog({
  open,
  onOpenChange,
  onCreate,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<unknown>;
}>) {
  const nameRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!nameRef.current?.commit()) throw new AsyncActionAbortError();
    try {
      await onCreate(name.trim());
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not create the group."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description="A group managed here. Add members and give it agent access once it exists."
      onOpenChange={(next) => {
        if (next) {
          setName("");
          setError(null);
        }
        onOpenChange(next);
      }}
      open={open}
      title="New group"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        <InlineValidation
          autoFocus
          hint="Usually a team or role, like Finance."
          id="group-name"
          label="Name"
          onChange={setName}
          placeholder="Finance"
          ref={nameRef}
          validate={(next) => (next.trim() ? null : "Enter a name.")}
          value={name}
        />
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
        <SettingsDialogActions
          onCancel={() => onOpenChange(false)}
          pending={pending}
        >
          <LoadingButton
            onAction={save}
            onStatusChange={(status) => setPending(status === "pending")}
            pendingLabel="Creating…"
            ref={saveRef}
            successLabel="Created"
            type="submit"
          >
            Create group
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}

// ─── One group ───────────────────────────────────────────────────────────────

export const GROUP_TABS = [
  { id: "members", label: "Members" },
  { id: "access", label: "Agent access" },
  { id: "identity", label: "Identity provider" },
] as const;

export type GroupTab = (typeof GROUP_TABS)[number]["id"];

/**
 * A group on its own page, outside Organization settings' tabs: a way back
 * to Groups, its name, and a tab each for its members, the access it holds
 * on each agent, and its identity-provider mapping. Synced groups take their
 * members from the provider, so only groups managed here add or remove
 * people.
 */
export function GroupDetailView({
  group,
  tab,
  onTabChange,
  onAddMember,
  onRemoveMember,
  onAccessChange,
  onDelete,
}: Readonly<{
  group: GroupDetail;
  tab: GroupTab;
  onTabChange: (tab: GroupTab) => void;
  onAddMember: (personId: string) => Promise<unknown>;
  onRemoveMember: (personId: string) => Promise<unknown>;
  onAccessChange: (
    agentId: string,
    level: AgentAccessLevel | null,
  ) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}>) {
  const selectedIndex = Math.max(
    0,
    GROUP_TABS.findIndex((item) => item.id === tab),
  );

  return (
    <SettingsChrome>
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-3">
          <Link
            className="flex w-fit items-center gap-1 text-caption text-muted-foreground transition-colors hover:text-foreground"
            to="/settings/organization/groups"
            viewTransition={PAGE_BACK}
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Groups
          </Link>
          <SettingsSectionTabs
            idPrefix="group-tabs"
            labels={GROUP_TABS.map((item) => item.label)}
            onSelect={(index) => {
              const next = GROUP_TABS[index];
              if (next) onTabChange(next.id);
            }}
            selectedIndex={selectedIndex}
            title={group.name}
          />
        </div>
        {tab === "members" ? (
          <GroupMembers
            group={group}
            onAddMember={onAddMember}
            onDelete={onDelete}
            onRemoveMember={onRemoveMember}
          />
        ) : null}
        {tab === "access" ? (
          <GroupAccess group={group} onAccessChange={onAccessChange} />
        ) : null}
        {tab === "identity" ? <GroupIdentity group={group} /> : null}
      </div>
    </SettingsChrome>
  );
}

function GroupMembers({
  group,
  onAddMember,
  onRemoveMember,
  onDelete,
}: Readonly<{
  group: GroupDetail;
  onAddMember: (personId: string) => Promise<unknown>;
  onRemoveMember: (personId: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}>) {
  const synced = group.source.kind === "directory";
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<OrgPerson | null>(null);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <SettingsSection
        actions={
          synced ? undefined : (
            <Button
              disabled={group.candidates.length === 0}
              leadingIcon={Plus}
              onClick={() => setAdding(true)}
              size="compact"
              type="button"
              variant="secondary"
            >
              Add member
            </Button>
          )
        }
        description={
          group.source.kind === "directory"
            ? `${plural(group.members.length, "member", "members")}, kept in sync with ${group.source.provider}. Change who's in it there.`
            : `${plural(group.members.length, "member", "members")}, managed here.`
        }
      >
        {group.members.length === 0 ? (
          <SettingsEmpty
            description={
              synced
                ? "Nobody is in the mapped groups yet."
                : "Add people from the organization."
            }
            title="No members yet"
          />
        ) : (
          <SettingsRows>
            {group.members.map((person) => (
              <SettingsRow
                description={person.email}
                key={person.id}
                label={person.name}
                leading={<SettingsAvatar name={person.name} />}
              >
                {synced ? null : (
                  <SettingsRowMenu
                    actions={[
                      {
                        label: "Remove from group",
                        icon: X,
                        onSelect: () => setRemoving(person),
                      },
                    ]}
                    label={`Actions for ${person.name}`}
                  />
                )}
              </SettingsRow>
            ))}
          </SettingsRows>
        )}
      </SettingsSection>

      {synced || group.managesAgents ? null : (
        <SettingsSection title="Delete group">
          <SettingsRows>
            <SettingsRow
              description="Removes its members' access through this group. People stay in the organization."
              label={`Delete ${group.name}`}
            >
              <Button
                onClick={() => setDeleting(true)}
                size="compact"
                type="button"
                variant="secondary"
              >
                Delete
              </Button>
            </SettingsRow>
          </SettingsRows>
        </SettingsSection>
      )}

      <AddMemberDialog
        candidates={group.candidates}
        onAdd={onAddMember}
        onOpenChange={setAdding}
        open={adding}
      />
      <SettingsConfirmDialog
        confirmLabel="Remove"
        description={
          removing
            ? `${removing.name} loses any agent access they had only through ${group.name}.`
            : undefined
        }
        onConfirm={() =>
          removing ? onRemoveMember(removing.id) : Promise.resolve()
        }
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        open={removing !== null}
        pendingLabel="Removing…"
        successLabel="Removed"
        title={removing ? `Remove ${removing.name}?` : "Remove member"}
      />
      <SettingsConfirmDialog
        confirmLabel="Delete group"
        description={`Every agent grant ${group.name} holds is removed with it.`}
        onConfirm={onDelete}
        onOpenChange={setDeleting}
        open={deleting}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title={`Delete ${group.name}?`}
      />
    </>
  );
}

function GroupAccess({
  group,
  onAccessChange,
}: Readonly<{
  group: GroupDetail;
  onAccessChange: (
    agentId: string,
    level: AgentAccessLevel | null,
  ) => Promise<unknown>;
}>) {
  return (
    <SettingsSection
      description={
        group.managesAgents
          ? "Developers manage every agent: its code, settings, and access."
          : "Operators work an agent's cases; viewers can only see them. The same access shows on each agent's Access tab."
      }
    >
      {group.agents.length === 0 ? (
        <SettingsEmpty
          description="Agents your organization creates will show up here."
          title="No agents yet"
        />
      ) : (
        <SettingsRows>
          {group.agents.map((agent) => (
            <GroupAgentRow
              agent={agent}
              key={agent.id}
              managesAgents={group.managesAgents}
              onChange={(level) => onAccessChange(agent.id, level)}
            />
          ))}
        </SettingsRows>
      )}
    </SettingsSection>
  );
}

function GroupIdentity({ group }: Readonly<{ group: GroupDetail }>) {
  const { source } = group;
  return (
    <SettingsSection description="Which identity-provider groups feed this one. The mapping is edited in WorkOS's Admin Portal, opened from Authentication.">
      <SettingsRows>
        <SettingsRow
          description={
            source.kind === "directory"
              ? `Members sync from ${source.provider}`
              : "Not mapped; members are managed here"
          }
          label={
            source.kind === "directory" ? (
              <span className="flex flex-wrap items-center gap-1.5">
                {source.idpGroups.map((name) => (
                  <Badge color="gray" key={name} size="sm">
                    {name}
                  </Badge>
                ))}
              </span>
            ) : (
              "No mapped groups"
            )
          }
        >
          <Button
            render={<Link to="/settings/organization/authentication" />}
            size="compact"
            trailingIcon={ShareUpRight}
            variant="secondary"
          >
            {source.kind === "directory" ? "Edit mapping" : "Map groups"}
          </Button>
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}

function GroupAgentRow({
  agent,
  managesAgents,
  onChange,
}: Readonly<{
  agent: GroupAgentAccess;
  managesAgents: boolean;
  onChange: (level: AgentAccessLevel | null) => Promise<unknown>;
}>) {
  const level: AccessValue = agent.level ?? "none";
  const covered =
    agent.everyone !== null && LEVEL_RANK[level] <= LEVEL_RANK[agent.everyone];

  return (
    <SettingsRow
      description={
        !managesAgents && covered && agent.everyone
          ? `${LEVEL_NAME[agent.everyone]} through Everyone`
          : undefined
      }
      label={
        <Link
          className="transition-colors hover:text-muted-foreground"
          params={{ agentId: agent.id }}
          to="/agents/$agentId/access"
        >
          {agent.name}
        </Link>
      }
    >
      {managesAgents ? (
        <Badge color="gray" size="sm">
          Manages
        </Badge>
      ) : (
        <AccessSelect
          label={`Access to ${agent.name}`}
          onChange={(next) => void onChange(next)}
          value={level}
        />
      )}
    </SettingsRow>
  );
}

function AddMemberDialog({
  open,
  onOpenChange,
  candidates,
  onAdd,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: readonly OrgPerson[];
  onAdd: (personId: string) => Promise<unknown>;
}>) {
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [personId, setPersonId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!personId) {
      setError("Choose someone to add.");
      throw new AsyncActionAbortError();
    }
    try {
      await onAdd(personId);
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not add them."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description="People already in the organization."
      onOpenChange={(next) => {
        if (next) {
          setPersonId("");
          setError(null);
        }
        onOpenChange(next);
      }}
      open={open}
      title="Add member"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        <Select onValueChange={setPersonId} value={personId}>
          <SelectTrigger aria-label="Person" placeholder="Choose a person" />
          <SelectContent>
            {candidates.map((person, index) => (
              <SelectItem index={index} key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
        <SettingsDialogActions
          onCancel={() => onOpenChange(false)}
          pending={pending}
        >
          <LoadingButton
            onAction={save}
            onStatusChange={(status) => setPending(status === "pending")}
            pendingLabel="Adding…"
            ref={saveRef}
            successLabel="Added"
            type="submit"
          >
            Add member
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}
