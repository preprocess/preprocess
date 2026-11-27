/**
 * In-memory organization platform settings: connected repositories. Changes
 * stick until the dev server restarts. There is no backend yet; builds outside
 * dev serve none.
 */

/**
 * Which deployments get a secret. New secrets default to production only,
 * so previews and dev sessions run on test credentials unless someone opts
 * them in.
 */
export type SecretScope = "production" | "preview" | "all";

export type NetworkRuleKind = "allow" | "block";

export type NetworkRule = {
  /** A host or URL pattern: `api.github.com`, `*.example.com`. */
  readonly pattern: string;
  readonly kind: NetworkRuleKind;
};

/** A repository the organization connected (Developers → Integrations). */
export type RepoConnection = {
  readonly id: string;
  /** `owner/name`. */
  readonly fullName: string;
};

type PlatformState = {
  repos: RepoConnection[];
};

function seed(): PlatformState {
  if (!import.meta.env.DEV) {
    return {
      repos: [],
    };
  }
  return {
    // Seeded: there is no GitHub connection flow yet.
    repos: [
      { id: "repo_agents", fullName: "acme/agents" },
      { id: "repo_lab", fullName: "acme/agent-lab" },
    ],
  };
}

let state: PlatformState | undefined;

function platform(): PlatformState {
  state ??= seed();
  return state;
}

export type PlatformSettings = {
  readonly repos: readonly RepoConnection[];
};

export function getPlatformSettings(): Promise<PlatformSettings> {
  const { repos } = platform();
  return Promise.resolve({
    repos: [...repos],
  });
}
