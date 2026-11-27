/**
 * In-memory organization platform settings: sandbox images. Changes stick
 * until the dev server restarts. There is no backend yet; builds outside dev
 * serve none.
 */

export type SandboxImage = {
  readonly id: string;
  /** Registry reference without the tag: `ghcr.io/preprocess/sandbox`. */
  readonly repository: string;
  readonly tag: string;
  /** Short content digest, as `sha256:…` would read in a registry. */
  readonly digest: string;
  readonly sizeMb: number;
  readonly addedAt: string;
};

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
  images: SandboxImage[];
  defaultImageId: string;
  repos: RepoConnection[];
};

const SEEDED_AT = "2026-08-10T12:00:00.000Z";

function seed(): PlatformState {
  if (!import.meta.env.DEV) {
    return {
      images: [],
      defaultImageId: "",
      repos: [],
    };
  }
  return {
    images: [
      {
        id: "img_base",
        repository: "ghcr.io/preprocess/sandbox",
        tag: "2026.08",
        digest: "sha256:4f9a1c2e",
        sizeMb: 812,
        addedAt: SEEDED_AT,
      },
      {
        id: "img_office",
        repository: "ghcr.io/preprocess/sandbox-office",
        tag: "2026.08",
        digest: "sha256:9b07de41",
        sizeMb: 1430,
        addedAt: "2026-08-12T09:30:00.000Z",
      },
      {
        id: "img_python",
        repository: "ghcr.io/preprocess/sandbox-python",
        tag: "3.13",
        digest: "sha256:c3e8a07f",
        sizeMb: 960,
        addedAt: "2026-08-14T16:45:00.000Z",
      },
    ],
    defaultImageId: "img_base",
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
  readonly images: readonly SandboxImage[];
  readonly defaultImageId: string;
  readonly repos: readonly RepoConnection[];
};

export function getPlatformSettings(): Promise<PlatformSettings> {
  const { images, defaultImageId, repos } = platform();
  return Promise.resolve({
    images: [...images],
    defaultImageId,
    repos: [...repos],
  });
}

export function addSandboxImage(
  repository: string,
  tag: string,
): Promise<SandboxImage> {
  const image: SandboxImage = {
    id: `img_${Date.now().toString(36)}`,
    repository,
    tag,
    // Seeded: a real registry reports these once the image is pulled.
    digest: `sha256:${Math.random().toString(16).slice(2, 10)}`,
    sizeMb: 500 + Math.round(Math.random() * 900),
    addedAt: new Date().toISOString(),
  };
  platform().images.push(image);
  return Promise.resolve(image);
}

export function removeSandboxImage(id: string): Promise<void> {
  const current = platform();
  if (current.defaultImageId === id) {
    return Promise.reject(new Error("Choose another default image first."));
  }
  current.images = current.images.filter((image) => image.id !== id);
  return Promise.resolve();
}

export function setDefaultSandboxImage(id: string): Promise<void> {
  platform().defaultImageId = id;
  return Promise.resolve();
}
