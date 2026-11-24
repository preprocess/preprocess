// `preprocess config pull` and `preprocess groups pull` (spec 5): bring
// preprocess.config.json in line with the dashboard. `config pull` writes the
// agent's dashboard overrides into `settings` and leaves `groups` alone;
// `groups pull` replaces only `groups` with the organization's groups.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ProjectConfig, ProjectSettings } from "@preprocess/sdk/protocol";

import { CONFIG_FILE, configPath } from "./deploy.ts";

export type PullOptions = {
  api: string;
  org: string;
  key: string;
  entry: string;
  fetch?: typeof fetch;
};

type Setting = { key: string; value: unknown; source: string };
type Group = { slug: string; name: string; description: string | null };

const get = async <T>(options: PullOptions, route: string): Promise<T> => {
  const url = new URL(
    `v1/orgs/${encodeURIComponent(options.org)}/${route}`,
    options.api.endsWith("/") ? options.api : `${options.api}/`,
  );
  const response = await (options.fetch ?? fetch)(url, {
    headers: { authorization: `Bearer ${options.key}` },
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      const { error } = JSON.parse(text) as {
        error?: string | { message?: string };
      };
      message = (typeof error === "string" ? error : error?.message) ?? text;
    } catch {
      // not JSON
    }
    throw new Error(`GET ${route} failed (${response.status}): ${message}`);
  }
  return JSON.parse(text) as T;
};

// The file deploy reads, or where it would look first: beside the nearest
// package.json above the entry, else beside the entry.
export const configTarget = (entry: string) => {
  const found = configPath(entry);
  if (found) return found;
  const start = path.dirname(path.resolve(entry));
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "package.json")))
      return path.join(dir, CONFIG_FILE);
    if (path.dirname(dir) === dir) return path.join(start, CONFIG_FILE);
  }
};

const update = (
  file: string,
  change: (config: ProjectConfig) => ProjectConfig,
) => {
  let config: ProjectConfig = {};
  if (existsSync(file))
    try {
      config = JSON.parse(readFileSync(file, "utf8")) as ProjectConfig;
    } catch (error) {
      throw new Error(`${file} is not valid JSON: ${String(error)}`);
    }
  writeFileSync(file, `${JSON.stringify(change(config), null, 2)}\n`);
};

const SCHEDULE_PREVIEWS = /^schedules\.([^.]+)\.previews$/;

// Dashboard overrides as preprocess.config.json settings.
export const overridesAsSettings = (settings: Setting[]): ProjectSettings => {
  const out: Record<string, unknown> & ProjectSettings = {};
  for (const { key, value, source } of settings) {
    if (source !== "override") continue;
    const schedule = SCHEDULE_PREVIEWS.exec(key)?.[1];
    if (schedule)
      out.schedules = {
        ...out.schedules,
        [schedule]: { previews: value as boolean },
      };
    else if (key === "evals.onPush") out.evals = { onPush: value as boolean };
    else out[key] = value;
  }
  return out;
};

export const configPull = async (options: PullOptions & { agent: string }) => {
  const { settings } = await get<{ settings: Setting[] }>(
    options,
    `agents/${encodeURIComponent(options.agent)}/settings`,
  );
  const keys = settings
    .filter((s) => s.source === "override")
    .map((s) => s.key);
  const file = configTarget(options.entry);
  if (keys.length === 0)
    return {
      file,
      out: `${options.agent} has no dashboard overrides; ${file} is unchanged.`,
    };
  const pulled = overridesAsSettings(settings);
  update(file, (config) => ({
    ...config,
    settings: {
      ...config.settings,
      ...pulled,
      ...((config.settings?.evals || pulled.evals) && {
        evals: { ...config.settings?.evals, ...pulled.evals },
      }),
      ...((config.settings?.schedules || pulled.schedules) && {
        schedules: Object.fromEntries(
          Object.entries({
            ...config.settings?.schedules,
            ...pulled.schedules,
          }).map(([name, s]) => [
            name,
            { ...config.settings?.schedules?.[name], ...s },
          ]),
        ),
      }),
    },
  }));
  return { file, out: `Wrote ${keys.join(", ")} to ${file}.` };
};

export const groupsPull = async (options: PullOptions) => {
  const groups = await get<Group[]>(options, "groups");
  const file = configTarget(options.entry);
  update(file, (config) => ({
    ...config,
    groups: groups.map((g) => ({
      slug: g.slug,
      name: g.name,
      ...(g.description && { description: g.description }),
    })),
  }));
  return { file, out: `Wrote ${groups.length} groups to ${file}.` };
};
