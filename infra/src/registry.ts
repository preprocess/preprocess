// Cloudflare's container registry holds at most 50 GB per account and reports
// no usage (PRE-90), so this walks it: every repository, tag and manifest, and
// the blobs they reference. It also deletes the images of preview stages,
// which nothing else removes. scripts/registry.ts is its command line, and
// scripts/stage.ts runs cleanStage when it destroys a preview.
//
// What a delete frees is unknown: deleting a tag removes its manifests within
// minutes, but Cloudflare documents no garbage collection of the blobs, and a
// prepared image's btrfs-chain artifact refuses deletion (409). Every number
// here is therefore an estimate of what the registry holds, not of what
// Cloudflare bills against the cap.

import { imageRepositories, names } from "./stages.ts";

const api = "https://api.cloudflare.com/client/v4";
const registryHost = "registry.cloudflare.com";

export const warnAtBytes = 35e9;
// A shared image younger than this may belong to a deploy still in progress,
// pushed but not yet referenced by any Worker, so the sweep leaves it.
const minimumAgeMs = 2 * 24 * 60 * 60 * 1000;

const accept = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(",");

export interface Credentials {
  account: string;
  token: string;
  registry: string;
}

export const credentials = async (): Promise<Credentials> => {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set",
    );
  }
  const { username, password } = await cloudflare<{
    username: string;
    password: string;
  }>(
    { account, token, registry: "" },
    `/accounts/${account}/containers/registries/${registryHost}/credentials`,
    {
      method: "POST",
      body: JSON.stringify({
        expiration_minutes: 60,
        permissions: ["pull", "push", "list"],
      }),
    },
  );
  return {
    account,
    token,
    registry: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
};

const retrying = async (request: () => Promise<Response>) => {
  for (let attempt = 1; ; attempt++) {
    const response = await request();
    if ((response.status !== 429 && response.status < 500) || attempt === 5) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
};

const cloudflare = async <T>(
  c: Credentials,
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await retrying(() =>
    fetch(`${api}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${c.token}`,
        "content-type": "application/json",
      },
    }),
  );
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`,
    );
  }
  return ((await response.json()) as { result: T }).result;
};

const registry = (c: Credentials, path: string, init: RequestInit = {}) =>
  retrying(() =>
    fetch(`https://${registryHost}/v2/${path}`, {
      ...init,
      headers: { authorization: c.registry, accept },
    }),
  );

const paginated = async (c: Credentials, path: string, field: string) => {
  const items: string[] = [];
  for (let next: string | undefined = path; next;) {
    const response = await registry(c, next);
    if (response.status === 404) return items;
    if (!response.ok) {
      throw new Error(
        `GET ${next}: ${response.status} ${await response.text()}`,
      );
    }
    items.push(
      ...(((await response.json()) as Record<string, string[] | null>)[field] ??
        []),
    );
    const link = /<\/v2\/([^>]+)>;\s*rel="next"/.exec(
      response.headers.get("link") ?? "",
    );
    next = link?.[1];
  }
  return items;
};

const inParallel = async <T, R>(items: T[], fn: (item: T) => Promise<R>) => {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += 8) {
    results.push(...(await Promise.all(items.slice(i, i + 8).map(fn))));
  }
  return results;
};

interface Descriptor {
  digest: string;
  size: number;
  mediaType?: string;
  annotations?: Record<string, string>;
}

interface Manifest {
  digest: string;
  kind: "index" | "image" | "attestation" | "chain";
  children: string[];
  config?: Descriptor | undefined;
  blobs: Descriptor[];
  // A btrfs-chain artifact's source image layers.
  sources: string[];
}

interface Repository {
  name: string;
  tags: Map<string, string>;
  manifests: Map<string, Manifest>;
}

const repositories = async (c: Credentials) =>
  (await paginated(c, "_catalog?n=1000", "repositories"))
    .filter((name) => name.startsWith(`${c.account}/`))
    .map((name) => name.slice(c.account.length + 1));

const walk = async (c: Credentials, name: string): Promise<Repository> => {
  const path = `${c.account}/${name}`;
  const tags = new Map<string, string>();
  const manifests = new Map<string, Manifest>();
  const read = async (reference: string) => {
    const response = await registry(c, `${path}/manifests/${reference}`);
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(
        `GET ${path}/manifests/${reference}: ${response.status} ${await response.text()}`,
      );
    }
    const digest = response.headers.get("docker-content-digest") ?? reference;
    if (manifests.has(digest)) return digest;
    const body = (await response.json()) as {
      artifactType?: string;
      manifests?: Descriptor[];
      config?: Descriptor;
      layers?: Descriptor[];
    };
    const children = (body.manifests ?? []).map((child) => child.digest);
    const layers = body.layers ?? [];
    manifests.set(digest, {
      digest,
      kind: body.manifests
        ? "index"
        : body.artifactType?.includes("btrfs-chain")
          ? "chain"
          : layers.some((layer) => layer.mediaType?.includes("in-toto"))
            ? "attestation"
            : "image",
      children,
      config: body.config,
      blobs: [...(body.config ? [body.config] : []), ...layers],
      sources: layers.flatMap((layer) => {
        const source =
          layer.annotations?.["io.cloudflare.cloudchamber.source_layer_digest"];
        return source ? [source] : [];
      }),
    });
    for (const child of children) await read(child);
    return digest;
  };
  for (const tag of await paginated(c, `${path}/tags/list?n=1000`, "tags")) {
    const digest = await read(tag);
    if (digest) tags.set(tag, digest);
  }
  return { name, tags, manifests };
};

const bytes = (manifests: Iterable<Manifest>) => {
  const blobs = new Map<string, number>();
  for (const manifest of manifests) {
    for (const blob of manifest.blobs) blobs.set(blob.digest, blob.size);
  }
  return blobs;
};

const sum = (blobs: Map<string, number>) =>
  [...blobs.values()].reduce((total, size) => total + size, 0);

const previewRepository = /-pr-(\d+)-[a-z0-9]+$/;

export const usage = async (c: Credentials) => {
  const walked = await inParallel(await repositories(c), (name) =>
    walk(c, name),
  );
  const all = walked.flatMap((repository) => [
    ...repository.manifests.values(),
  ]);
  const group = (name: string) =>
    previewRepository.test(name)
      ? "previews (per-PR repositories)"
      : name.replace(/-(staging|production)-[a-z0-9]+$/, "-$1");
  const groups = new Map<string, Repository[]>();
  for (const repository of walked) {
    groups.set(group(repository.name), [
      ...(groups.get(group(repository.name)) ?? []),
      repository,
    ]);
  }
  return {
    repositories: walked.length,
    // Each blob once, as the registry stores it: blobs are shared account-wide.
    uniqueBytes: sum(bytes(all)),
    // Each repository's blobs counted in full, in case the cap counts that way.
    perRepositoryBytes: walked.reduce(
      (total, repository) => total + sum(bytes(repository.manifests.values())),
      0,
    ),
    chainBytes: sum(bytes(all.filter((manifest) => manifest.kind === "chain"))),
    groups: [...groups]
      .map(([name, members]) => ({
        name,
        repositories: members.length,
        tags: members.reduce((total, member) => total + member.tags.size, 0),
        bytes: sum(
          bytes(members.flatMap((member) => [...member.manifests.values()])),
        ),
      }))
      .sort((a, b) => b.bytes - a.bytes),
  };
};

// Every image a Worker version references, as "<repository>@<digest>". Every
// version counts, not only the deployed one, so a rollback to any version
// Cloudflare keeps still finds its images.
const referencedImages = async (c: Credentials, scripts?: string[]) => {
  const base = `/accounts/${c.account}/workers/scripts`;
  type Version = {
    resources?: {
      script_runtime?: { containers?: { images?: Record<string, string> }[] };
    };
  };
  const images = (version: Version) =>
    (version.resources?.script_runtime?.containers ?? []).flatMap((container) =>
      Object.values(container.images ?? {}).flatMap((image) => {
        const match = new RegExp(
          `^${registryHost}/${c.account}/([^@]+)@(sha256:[0-9a-f]+)$`,
        ).exec(image);
        return match ? [`${match[1]}@${match[2]}`] : [];
      }),
    );
  const names =
    scripts ??
    (await cloudflare<{ id: string }[]>(c, base)).map((script) => script.id);
  const referenced = new Set<string>();
  await inParallel(names, async (name) => {
    const versions = await cloudflare<{ items: { id: string }[] }>(
      c,
      `${base}/${name}/versions?per_page=100`,
    ).catch((error: Error) => {
      if (scripts && error.message.includes(": 404 ")) return { items: [] };
      throw error;
    });
    const [latest, ...older] = versions.items;
    if (!latest) return;
    const read = async (id: string) =>
      images(await cloudflare<Version>(c, `${base}/${name}/versions/${id}`));
    const first = await read(latest.id);
    // A Worker without containers in its newest version is not read further.
    if (first.length === 0 && !scripts) return;
    for (const image of first) referenced.add(image);
    for (const versionImages of await inParallel(older, (version) =>
      read(version.id),
    )) {
      for (const image of versionImages) referenced.add(image);
    }
  });
  return referenced;
};

// The images a stage's Workers reference. Read before the stage is destroyed,
// since destroying it deletes the Workers and their versions.
export const stageImages = (c: Credentials, stage: string) => {
  const n = names(stage);
  return referencedImages(c, [n.builder, n.pdfRender]);
};

const created = async (
  c: Credentials,
  repository: Repository,
  manifest: Manifest,
) => {
  const image = manifest.children
    .map((child) => repository.manifests.get(child))
    .find((child) => child?.kind === "image");
  const config = (image ?? manifest).config;
  if (!config) return undefined;
  const response = await registry(
    c,
    `${c.account}/${repository.name}/blobs/${config.digest}`,
  );
  if (!response.ok) return undefined;
  const { created } = (await response.json()) as { created?: string };
  return created ? Date.parse(created) : undefined;
};

// Deletes the tags of the given images (index or manifest digests) and of the
// btrfs-chain artifacts prepared from them, keeping everything the repository's
// other images still use.
const deleteImages = async (
  c: Credentials,
  repository: Repository,
  doomed: Set<string>,
) => {
  const closure = (digests: Iterable<string>) => {
    const result = new Set<string>();
    const visit = (digest: string) => {
      if (result.has(digest)) return;
      result.add(digest);
      for (const child of repository.manifests.get(digest)?.children ?? [])
        visit(child);
    };
    for (const digest of digests) visit(digest);
    return result;
  };
  const chains = [...repository.manifests.values()].filter(
    (manifest) => manifest.kind === "chain",
  );
  const doomedClosure = closure(doomed);
  // An index's children carry tags of their own, so the images kept are the
  // tagged manifests outside the doomed images, and everything under them.
  const kept = closure(
    [...repository.tags.values()].filter(
      (digest) =>
        !doomedClosure.has(digest) &&
        repository.manifests.get(digest)?.kind !== "chain",
    ),
  );
  const deleted = [...doomedClosure].filter(
    (digest) =>
      !kept.has(digest) && repository.manifests.get(digest)?.kind !== "chain",
  );
  const layers = (digests: Iterable<string>) =>
    new Set(
      [...digests].flatMap(
        (digest) =>
          repository.manifests.get(digest)?.blobs.map((blob) => blob.digest) ??
          [],
      ),
    );
  const keptLayers = layers(kept);
  const deletedLayers = layers(deleted);
  const doomedChains = chains
    .filter(
      (chain) =>
        chain.sources.some((source) => deletedLayers.has(source)) &&
        !chain.sources.every((source) => keptLayers.has(source)),
    )
    .map((chain) => chain.digest);
  const targets = new Set([...deleted, ...doomedChains]);
  const result = { deleted: 0, refused: [] as string[], bytes: 0 };
  const keptBlobs = bytes(
    [...kept].flatMap((digest) => repository.manifests.get(digest) ?? []),
  );
  for (const [digest, size] of bytes(
    [...targets].flatMap((digest) => repository.manifests.get(digest) ?? []),
  )) {
    if (!keptBlobs.has(digest)) result.bytes += size;
  }
  for (const [tag, digest] of repository.tags) {
    if (!targets.has(digest)) continue;
    const response = await registry(
      c,
      `${c.account}/${repository.name}/manifests/${tag}`,
      { method: "DELETE" },
    );
    // Deleting a tag can take its digest's other tags with it.
    if (response.ok || response.status === 404) result.deleted++;
    else
      result.refused.push(
        `${tag}: ${response.status} ${(await response.text()).slice(0, 200)}`,
      );
  }
  return result;
};

export interface Cleaned {
  repository: string;
  deleted: number;
  refused: string[];
  bytes: number;
}

const legacyRepositories = (all: string[], keep: (pr: number) => boolean) =>
  all.filter((name) => {
    const pr = previewRepository.exec(name)?.[1];
    return pr !== undefined && !keep(Number(pr));
  });

// After a preview is destroyed: its own per-PR repositories, then, unless the
// pull request merged (main builds the same image and reuses it), the images
// in the shared repositories that only this stage referenced.
export const cleanStage = async (
  c: Credentials,
  stage: `pr-${number}`,
  images: Set<string>,
  options: { merged: boolean },
) => {
  const pr = Number(stage.slice(3));
  const all = await repositories(c);
  const live = await referencedImages(c);
  const cleaned: Cleaned[] = [];
  for (const name of legacyRepositories(all, (n) => n !== pr)) {
    const repository = await walk(c, name);
    const doomed = new Set(
      [...repository.tags.values()].filter(
        (digest) => !live.has(`${name}@${digest}`),
      ),
    );
    cleaned.push({
      repository: name,
      ...(await deleteImages(c, repository, doomed)),
    });
  }
  if (options.merged) return cleaned;
  for (const name of Object.values(imageRepositories)) {
    if (!all.includes(name)) continue;
    const repository = await walk(c, name);
    const doomed = new Set(
      [...repository.tags.values()].filter(
        (digest) =>
          images.has(`${name}@${digest}`) && !live.has(`${name}@${digest}`),
      ),
    );
    if (doomed.size > 0)
      cleaned.push({
        repository: name,
        ...(await deleteImages(c, repository, doomed)),
      });
  }
  return cleaned;
};

// Everything no Worker version references: the per-PR repositories of pull
// requests that are neither open nor deployed, and the shared repositories'
// images older than two days. Never staging's or production's own
// repositories, and never a repository this stack does not own.
export const sweep = async (c: Credentials, openPullRequests: Set<number>) => {
  const all = await repositories(c);
  const live = await referencedImages(c);
  const deployed = new Set(
    (
      await cloudflare<{ id: string }[]>(
        c,
        `/accounts/${c.account}/workers/scripts`,
      )
    ).flatMap((script) => {
      const pr = /^preprocess-.+-pr-(\d+)$/.exec(script.id)?.[1];
      return pr ? [Number(pr)] : [];
    }),
  );
  const cleaned: Cleaned[] = [];
  for (const name of legacyRepositories(
    all,
    (pr) => openPullRequests.has(pr) || deployed.has(pr),
  )) {
    const repository = await walk(c, name);
    const doomed = new Set(
      [...repository.tags.values()].filter(
        (digest) => !live.has(`${name}@${digest}`),
      ),
    );
    cleaned.push({
      repository: name,
      ...(await deleteImages(c, repository, doomed)),
    });
  }
  for (const name of Object.values(imageRepositories)) {
    if (!all.includes(name)) continue;
    const repository = await walk(c, name);
    const doomed = new Set<string>();
    for (const [tag, digest] of repository.tags) {
      if (!/^[0-9a-f]{16}$/.test(tag) || live.has(`${name}@${digest}`))
        continue;
      const at = await created(
        c,
        repository,
        repository.manifests.get(digest)!,
      );
      if (at !== undefined && Date.now() - at > minimumAgeMs)
        doomed.add(digest);
    }
    if (doomed.size > 0)
      cleaned.push({
        repository: name,
        ...(await deleteImages(c, repository, doomed)),
      });
  }
  return cleaned;
};
