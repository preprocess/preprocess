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
import { SizeProvider } from "@preprocess/ui/lib/size-context";
import { useRef, useState, type FormEvent } from "react";

import { AgentMcpSection } from "../developers/mcp-servers";
import { AgentNetworkSection } from "../developers/network-section";
import type {
  McpServerInput,
  NetworkRule,
  PlatformSettings,
  RepoConnection,
  SecretScope,
} from "../developers/platform-store";
import { imageLabel } from "../developers/sandbox-images-section";
import { SecretsSection } from "../developers/secret-list";
import {
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  actionErrorMessage,
} from "../settings/kit";
import { AgentAccess } from "./agent-page";
import type { AgentAccessLevel } from "./agent-seed";
import { DEFAULT_PRODUCTION_BRANCH, type AgentRepo } from "./agent-store";
import type { OrgAgentDetail } from "./list-org-agents";

const DEFAULT_IMAGE = "default";

/**
 * The two agent tabs this view draws: Access, and Settings, which stacks
 * the small per-agent layers on organization settings (sandbox image,
 * secrets, MCP servers, network).
 */
export type AgentSettingsSection = "access" | "settings";

function validateRepoPath(value: string) {
  const path = value.trim();
  if (!path) return "Enter the agent's folder, like agents/intake.";
  if (path.startsWith("/"))
    return "Use a path from the repository root, without a leading slash.";
  if (path.split("/").includes(".."))
    return "The path can't step out of the repository.";
  return null;
}

/** Choose the connected repository and the agent's folder in it. */
function RepoDialog({
  repo,
  repos,
  onOpenChange,
  onSave,
}: Readonly<{
  repo: AgentRepo | null;
  repos: readonly RepoConnection[];
  onOpenChange: (open: boolean) => void;
  onSave: (repo: AgentRepo | null) => Promise<unknown>;
}>) {
  const pathRef = useRef<InlineValidationHandle>(null);
  const branchRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [repoId, setRepoId] = useState(repo?.repoId ?? repos[0]?.id ?? "");
  const [path, setPath] = useState(repo?.path ?? "");
  const [branch, setBranch] = useState(
    repo?.productionBranch ?? DEFAULT_PRODUCTION_BRANCH,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const pathOk = Boolean(pathRef.current?.commit());
    const branchOk = Boolean(branchRef.current?.commit());
    if (!repoId || !pathOk || !branchOk) {
      throw new AsyncActionAbortError();
    }
    try {
      await onSave({
        repoId,
        path: path.trim().replace(/\/+$/, ""),
        productionBranch: branch.trim(),
      });
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not save the repository."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description="Every branch deploys from this folder: the production branch builds for production, and other branches get previews. Repositories are connected in Developers → Integrations."
      onOpenChange={onOpenChange}
      open
      title="Repository"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-body text-foreground">Repository</span>
          <Select onValueChange={setRepoId} value={repoId}>
            <SelectTrigger aria-label="Repository" />
            <SelectContent>
              {repos.map((item, index) => (
                <SelectItem index={index} key={item.id} value={item.id}>
                  {item.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <InlineValidation
          autoFocus
          hint="The agent's folder, from the repository root."
          id="repo-path"
          label="Path"
          onChange={setPath}
          placeholder="agents/intake"
          ref={pathRef}
          validate={validateRepoPath}
          value={path}
        />
        <InlineValidation
          hint="Builds of this branch are production; others are previews."
          id="repo-production-branch"
          label="Production branch"
          onChange={setBranch}
          placeholder="main"
          ref={branchRef}
          validate={(next) =>
            next.trim() ? null : "Enter a branch, like main."
          }
          value={branch}
        />
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
        <SettingsDialogActions
          onCancel={() => onOpenChange(false)}
          pending={pending}
        >
          {repo ? (
            <LoadingButton
              onAction={async () => {
                await onSave(null);
                window.setTimeout(() => onOpenChange(false), 400);
              }}
              pendingLabel="Disconnecting…"
              successLabel="Disconnected"
              variant="ghost"
            >
              Disconnect
            </LoadingButton>
          ) : null}
          <LoadingButton
            onAction={save}
            onStatusChange={(status) => setPending(status === "pending")}
            pendingLabel="Saving…"
            ref={saveRef}
            successLabel="Saved"
            type="submit"
          >
            Save
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}

/** "acme/agents · agents/intake", or null when not connected. */
function repoSummary(
  repo: AgentRepo | null,
  repos: readonly RepoConnection[],
): string | null {
  if (!repo) return null;
  const name =
    repos.find((item) => item.id === repo.repoId)?.fullName ?? repo.repoId;
  return `${name} · ${repo.path} · production from ${repo.productionBranch}`;
}

export type AgentSettingsActions = {
  readonly setRepo: (repo: AgentRepo | null) => Promise<unknown>;
  readonly setAccess: (
    group: string,
    level: AgentAccessLevel | null,
  ) => Promise<unknown>;
  readonly setEveryoneAccess: (
    level: AgentAccessLevel | null,
  ) => Promise<unknown>;
  readonly setSandboxImage: (imageId: string | null) => Promise<unknown>;
  readonly saveEnvVar: (
    key: string,
    value: string,
    scope: SecretScope,
  ) => Promise<unknown>;
  readonly deleteEnvVar: (key: string) => Promise<unknown>;
  readonly addNetworkRule: (rule: NetworkRule) => Promise<unknown>;
  readonly deleteNetworkRule: (pattern: string) => Promise<unknown>;
  readonly setMcpEnabled: (
    serverId: string,
    enabled: boolean,
  ) => Promise<unknown>;
  readonly setMcpTools: (
    serverId: string,
    tools: readonly string[] | null,
  ) => Promise<unknown>;
  readonly saveMcpServer: (
    input: McpServerInput,
    id?: string,
  ) => Promise<unknown>;
  readonly deleteMcpServer: (id: string) => Promise<unknown>;
};

export function AgentSettings({
  agent,
  platform,
  actions,
  section,
}: Readonly<{
  agent: OrgAgentDetail;
  platform: PlatformSettings;
  actions: AgentSettingsActions;
  /** The tab being shown. */
  section: AgentSettingsSection;
}>) {
  const [editingRepo, setEditingRepo] = useState(false);
  const defaultImage = platform.images.find(
    (image) => image.id === platform.defaultImageId,
  );
  const repoText = repoSummary(agent.repo, platform.repos);

  return (
    <>
      {section === "access" ? (
        <AgentAccess
          agent={agent}
          onChange={actions.setAccess}
          onEveryoneChange={actions.setEveryoneAccess}
        />
      ) : null}
      {section === "settings" ? (
        <SettingsSection
          description="Where this agent's code lives. Every branch deploys: the production branch for production, others to previews. Repositories are connected in Developers → Integrations."
          title="Repository"
        >
          <SettingsRows>
            <SettingsRow
              label="Source"
              value={
                repoText ? (
                  <span className="truncate">{repoText}</span>
                ) : (
                  <span className="text-muted-foreground">Not connected</span>
                )
              }
            >
              <Button
                disabled={platform.repos.length === 0}
                onClick={() => setEditingRepo(true)}
                size="compact"
                type="button"
                variant="secondary"
              >
                {agent.repo ? "Edit" : "Connect"}
              </Button>
            </SettingsRow>
          </SettingsRows>
          {editingRepo ? (
            <RepoDialog
              onOpenChange={setEditingRepo}
              onSave={actions.setRepo}
              repo={agent.repo}
              repos={platform.repos}
            />
          ) : null}
        </SettingsSection>
      ) : null}
      {section === "settings" ? (
        <SettingsSection
          description="The Docker image this agent's sandbox starts from. The organization's images are managed in Developers → Sandbox images."
          title="Sandbox image"
        >
          <SettingsRows>
            <SettingsRow
              label="Image"
              value={
                <SizeProvider size="compact">
                  <Select
                    onValueChange={(value) =>
                      void actions.setSandboxImage(
                        value === DEFAULT_IMAGE ? null : value,
                      )
                    }
                    value={agent.sandboxImageId ?? DEFAULT_IMAGE}
                  >
                    <SelectTrigger
                      aria-label="Sandbox image"
                      className="w-80"
                    />
                    <SelectContent>
                      <SelectItem index={0} value={DEFAULT_IMAGE}>
                        {defaultImage
                          ? `Organization default (${imageLabel(defaultImage)})`
                          : "Organization default"}
                      </SelectItem>
                      {platform.images.map((image, index) => (
                        <SelectItem
                          index={index + 1}
                          key={image.id}
                          value={image.id}
                        >
                          {imageLabel(image)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SizeProvider>
              }
            />
          </SettingsRows>
        </SettingsSection>
      ) : null}
      {section === "settings" ? (
        <SecretsSection
          description="Available to this agent's deployed code, after the organization's secrets, which can't be overridden. Organization secrets are managed in Developers → Secrets."
          inherited={platform.secrets}
          items={agent.env}
          noun="secret"
          onDelete={actions.deleteEnvVar}
          onSave={actions.saveEnvVar}
          title="Secrets"
        />
      ) : null}
      {section === "settings" ? (
        <AgentMcpSection
          grants={agent.mcp}
          onDelete={actions.deleteMcpServer}
          onEnable={actions.setMcpEnabled}
          onSave={actions.saveMcpServer}
          onTools={actions.setMcpTools}
          organization={platform.mcpServers}
          servers={agent.mcpServers}
          title="MCP servers"
        />
      ) : null}
      {section === "settings" ? (
        <AgentNetworkSection
          title="Network"
          onAdd={actions.addNetworkRule}
          onDelete={actions.deleteNetworkRule}
          organization={platform.network}
          rules={agent.network}
        />
      ) : null}
    </>
  );
}
