import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
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
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Link, Plus, ShareUpRight, X } from "@preprocess/ui/lib/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";

import { NoAccessArt, NothingCreatedArt } from "../../components/empty-art";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";
import { useOrganizationId } from "../auth/auth-context";
import { orgApi } from "../auth/client";
import {
  SettingsConfirmDialog,
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsEmpty,
  SettingsError,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsSection,
  SettingsSkeletonRows,
} from "../settings/kit";
import { SettingsStacked } from "../settings/settings-widgets";
import { useAdministers } from "../settings/use-role";

/**
 * Developers → GitHub: install the GitHub App for the organization, see the
 * accounts it is installed on and the repositories they grant, and link a
 * repository to an agent so every push builds and deploys it
 * (/v1/orgs/:org/github/*, docs/design/08-github-app.md). Owners and Admins
 * only.
 */

type Installation = {
  id: string;
  account: string;
  accountType: string;
  suspended: boolean;
  repositories: number;
  manageUrl: string;
};

type RepositoryLink = {
  agent: string;
  branch: string | null;
  directory: string;
  entry: string;
};

type Repository = {
  fullName: string;
  private: boolean;
  defaultBranch: string | null;
  account: string;
  suspended: boolean;
  link: RepositoryLink | null;
};

type LinkTarget = { repository: string | null; current: RepositoryLink | null };

const AGENT_SLUG = /^[a-z][a-z0-9-]{0,62}$/;

function validateAgent(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Enter an agent name.";
  return AGENT_SLUG.test(trimmed)
    ? null
    : "Use lowercase letters, numbers and dashes, starting with a letter.";
}

function validatePath(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("/") || trimmed.split("/").includes("..")
    ? "Enter a relative path inside the repository, such as agents/support."
    : null;
}

/** GitHub's mark, monochrome in the current text color. */
function GitHubMark() {
  return (
    <svg
      aria-hidden="true"
      className="size-[18px] shrink-0 text-foreground"
      fill="currentColor"
      viewBox="0 0 16 16"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function Name({ children }: Readonly<{ children: string }>) {
  return (
    <span
      className="truncate text-body text-foreground"
      style={{ fontVariationSettings: fontWeights.semibold }}
    >
      {children}
    </span>
  );
}

function linkDescription(link: RepositoryLink) {
  return [
    "Deploys " + link.agent,
    link.branch ? "from " + link.branch : "from every branch",
    link.directory ? "in " + link.directory : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function GitHubSettings() {
  const administers = useAdministers();
  if (administers === undefined)
    return (
      <SettingsSection title="GitHub App">
        <SettingsSkeletonRows count={1} />
      </SettingsSection>
    );
  if (!administers)
    return (
      <SettingsEmpty
        art={<NoAccessArt />}
        description="Only organization Owners and Admins can connect GitHub and link repositories to agents."
        title="Admin access required"
      />
    );
  return <GitHubSections />;
}

function GitHubSections() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const installations = useQuery({
    queryKey: ["github-installations", organizationId],
    queryFn: () =>
      orgApi<{ configured: boolean; installations: Installation[] }>(
        organizationId,
        "/github/installations",
      ),
  });
  const repositories = useQuery({
    queryKey: ["github-repositories", organizationId],
    queryFn: () => orgApi<Repository[]>(organizationId, "/github/repositories"),
    enabled: Boolean(installations.data?.installations.length),
  });
  const [linking, setLinking] = useState<LinkTarget | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["github-installations", organizationId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["github-repositories", organizationId],
      }),
    ]);

  async function install() {
    const { url } = await orgApi<{ url: string }>(
      organizationId,
      "/github/install",
      { method: "POST" },
    );
    window.location.assign(url);
  }

  if (installations.isError)
    return <SettingsError error={installations.error} />;
  if (installations.data === undefined)
    return (
      <SettingsSection title="GitHub App">
        <SettingsSkeletonRows count={1} />
      </SettingsSection>
    );

  const { configured } = installations.data;
  const accounts = installations.data.installations;

  if (accounts.length === 0)
    return (
      <SettingsSection
        description={
          configured
            ? "Install the GitHub App on your GitHub account or organization, then link a repository to an agent. Every push builds and deploys the agent."
            : "The GitHub App isn't configured on this install yet. Ask your administrator to add its credentials."
        }
        title="GitHub App"
      >
        <div className="flex [&_[data-slot=loading-button]]:w-auto">
          <LoadingButton
            disabled={!configured}
            onAction={install}
            pendingLabel="Opening GitHub…"
            successLabel="Opening GitHub…"
          >
            Install GitHub App
          </LoadingButton>
        </div>
      </SettingsSection>
    );

  const repos = repositories.data ?? [];

  return (
    <SettingsStacked>
      <SettingsSection
        actions={
          <LoadingButton
            className="w-auto"
            disabled={!configured}
            onAction={install}
            pendingLabel="Opening GitHub…"
            size="compact"
            successLabel="Opening GitHub…"
            variant="secondary"
          >
            Add account
          </LoadingButton>
        }
        description="GitHub accounts and organizations with the App installed. Choose which repositories it can access under Manage."
        title="Accounts"
      >
        <SettingsRows>
          {accounts.map((account) => (
            <SettingsRow
              description={
                account.repositories === 1
                  ? "1 repository"
                  : account.repositories + " repositories"
              }
              key={account.id}
              label={<Name>{account.account}</Name>}
              leading={<GitHubMark />}
            >
              {account.suspended ? (
                <Badge className="shrink-0" size="sm">
                  Suspended
                </Badge>
              ) : null}
              <Button
                render={
                  <a
                    href={account.manageUrl}
                    rel="noreferrer"
                    target="_blank"
                  />
                }
                size="compact"
                trailingIcon={ShareUpRight}
                variant="ghost"
              >
                Manage
              </Button>
            </SettingsRow>
          ))}
        </SettingsRows>
      </SettingsSection>
      <SettingsSection
        actions={
          repos.length ? (
            <Button
              leadingIcon={Plus}
              onClick={() => setLinking({ repository: null, current: null })}
              size="compact"
              type="button"
              variant="secondary"
            >
              Link agent
            </Button>
          ) : null
        }
        description="Link a repository to an agent so every push builds and deploys it."
        title="Repositories"
      >
        {repositories.isError ? (
          <SettingsError error={repositories.error} />
        ) : repositories.data === undefined ? (
          <SettingsSkeletonRows count={3} />
        ) : repos.length === 0 ? (
          <SettingsEmpty
            art={<NothingCreatedArt />}
            description="The GitHub App doesn't have access to any repositories yet. Grant access under Manage."
            title="No repositories"
          />
        ) : (
          <SettingsRows>
            {repos.map((repo) => {
              const link = repo.link;
              return (
                <SettingsRow
                  description={link ? linkDescription(link) : "Not linked"}
                  key={repo.fullName + ":" + (link?.agent ?? "")}
                  label={<Name>{repo.fullName}</Name>}
                >
                  {repo.private ? (
                    <Badge className="shrink-0" size="sm">
                      Private
                    </Badge>
                  ) : null}
                  {link ? (
                    <SettingsRowMenu
                      actions={[
                        {
                          label: "Edit link",
                          icon: Link,
                          onSelect: () =>
                            setLinking({
                              repository: repo.fullName,
                              current: link,
                            }),
                        },
                        {
                          label: "Unlink",
                          icon: X,
                          onSelect: () => setUnlinking(link.agent),
                        },
                      ]}
                      label={"Actions for " + repo.fullName}
                    />
                  ) : (
                    <Button
                      onClick={() =>
                        setLinking({ repository: repo.fullName, current: null })
                      }
                      size="compact"
                      type="button"
                      variant="secondary"
                    >
                      Link
                    </Button>
                  )}
                </SettingsRow>
              );
            })}
          </SettingsRows>
        )}
      </SettingsSection>
      <SettingsDialogShell
        description="Every push builds and deploys the agent. A new name creates the agent on its first build."
        onOpenChange={(open) => {
          if (!open) setLinking(null);
        }}
        open={linking !== null}
        title={linking?.current ? "Edit link" : "Link a repository"}
      >
        {linking ? (
          <LinkForm
            onCancel={() => setLinking(null)}
            onLinked={() => {
              void refresh();
              setLinking(null);
            }}
            organizationId={organizationId}
            repositories={repos}
            target={linking}
          />
        ) : null}
      </SettingsDialogShell>
      <SettingsConfirmDialog
        confirmLabel="Unlink"
        description={
          "Pushes to this repository will stop deploying " +
          (unlinking ?? "this agent") +
          ". The agent and its existing deployments stay intact."
        }
        onConfirm={async () => {
          if (!unlinking) return;
          await orgApi(organizationId, "/agents/" + unlinking + "/github", {
            method: "DELETE",
          });
          await refresh();
        }}
        onOpenChange={(open) => {
          if (!open) setUnlinking(null);
        }}
        open={unlinking !== null}
        pendingLabel="Unlinking…"
        successLabel="Unlinked"
        title={"Unlink " + (unlinking ?? "this agent") + "?"}
      />
    </SettingsStacked>
  );
}

function LinkForm({
  target,
  organizationId,
  repositories,
  onCancel,
  onLinked,
}: Readonly<{
  target: LinkTarget;
  organizationId: string;
  repositories: Repository[];
  onCancel: () => void;
  onLinked: () => void;
}>) {
  const editing = target.current !== null;
  const names = [...new Set(repositories.map((repo) => repo.fullName))];
  const defaultBranch = (name: string) =>
    repositories.find((repo) => repo.fullName === name)?.defaultBranch ?? "";
  const agentRef = useRef<ValidatedFieldHandle>(null);
  const directoryRef = useRef<ValidatedFieldHandle>(null);
  const entryRef = useRef<ValidatedFieldHandle>(null);
  const linkRef = useRef<LoadingButtonHandle>(null);
  const [agent, setAgent] = useState(target.current?.agent ?? "");
  const [repository, setRepository] = useState(
    target.repository ?? names[0] ?? "",
  );
  const [branch, setBranch] = useState(
    target.current ? (target.current.branch ?? "") : defaultBranch(repository),
  );
  const [directory, setDirectory] = useState(target.current?.directory ?? "");
  const [entry, setEntry] = useState(target.current?.entry ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function link() {
    setError(null);
    const valid = [agentRef, directoryRef, entryRef].map(
      (ref) => ref.current?.commit() ?? true,
    );
    if (valid.includes(false)) throw new AsyncActionAbortError();
    try {
      await orgApi(organizationId, "/agents/" + agent.trim() + "/github", {
        method: "PUT",
        body: JSON.stringify({
          repository,
          branch: branch.trim() || null,
          directory: directory.trim(),
          ...(entry.trim() && { entry: entry.trim() }),
        }),
      });
      onLinked();
    } catch (cause) {
      setError(cause);
      throw cause;
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        linkRef.current?.run();
      }}
    >
      <div className="flex flex-col divide-y divide-border/60 [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
        <ValidatedField
          autoFocus
          disabled={editing}
          hint="Enter an existing agent, or a new name to create one on the first build."
          id="github-link-agent"
          label="Agent"
          onChange={setAgent}
          placeholder="support"
          ref={agentRef}
          validate={validateAgent}
          value={agent}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-body text-foreground">Repository</span>
          <Select
            onValueChange={(value) => {
              if (typeof value !== "string") return;
              setRepository(value);
              setBranch(defaultBranch(value));
            }}
            value={repository}
          >
            <SelectTrigger aria-label="Repository" />
            <SelectContent>
              {names.map((name, index) => (
                <SelectItem index={index} key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ValidatedField
          hint="Leave blank to deploy every branch. Non-production branches deploy as previews."
          id="github-link-branch"
          label="Branch"
          onChange={setBranch}
          placeholder="main"
          validate={() => null}
          value={branch}
        />
        <ValidatedField
          hint="Optional. Folder in the repository (blank for the root)."
          id="github-link-directory"
          label="Directory"
          onChange={setDirectory}
          placeholder="agents/support"
          ref={directoryRef}
          validate={validatePath}
          value={directory}
        />
        <ValidatedField
          hint="Optional. Entry module inside the directory (defaults to src/index.ts)."
          id="github-link-entry"
          label="Entry file"
          onChange={setEntry}
          placeholder="src/index.ts"
          ref={entryRef}
          validate={validatePath}
          value={entry}
        />
      </div>
      {error ? <SettingsError error={error} inline /> : null}
      <SettingsDialogActions onCancel={onCancel} pending={pending}>
        <LoadingButton
          onAction={link}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel={editing ? "Saving…" : "Linking…"}
          ref={linkRef}
          successLabel={editing ? "Saved" : "Linked"}
          type="submit"
        >
          {editing ? "Save" : "Link"}
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}
