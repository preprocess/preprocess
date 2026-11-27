// What `preprocess login` saves: the API origin, the session token it was
// given and the organization it chose, in a file only the user can read.
// PREPROCESS_API_KEY, PREPROCESS_ORG, PREPROCESS_API_URL and the flags win
// over it, so CI keeps working from the environment alone.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type Credentials = {
  api: string;
  token: string;
  email?: string | undefined;
  org?: string | undefined;
};

export const credentialsPath = (env: NodeJS.ProcessEnv) =>
  path.join(
    env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
    "preprocess",
    "credentials.json",
  );

export const readCredentials = (
  env: NodeJS.ProcessEnv,
): Credentials | undefined => {
  try {
    return JSON.parse(
      readFileSync(credentialsPath(env), "utf8"),
    ) as Credentials;
  } catch {
    return undefined;
  }
};

export const writeCredentials = (
  env: NodeJS.ProcessEnv,
  credentials: Credentials,
) => {
  const file = credentialsPath(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(credentials, null, 2) + "\n", {
    mode: 0o600,
  });
  chmodSync(file, 0o600);
  return file;
};

// The API origin, organization and bearer token one command uses. A saved
// session counts only for the API it was issued by.
export const resolveTarget = (
  values: { api?: string | undefined; org?: string | undefined },
  env: NodeJS.ProcessEnv,
) => {
  const saved = readCredentials(env);
  const api = values.api ?? env.PREPROCESS_API_URL ?? saved?.api;
  const session = saved && saved.api === api ? saved : undefined;
  return {
    api,
    org: values.org ?? env.PREPROCESS_ORG ?? session?.org,
    key: env.PREPROCESS_API_KEY ?? session?.token,
  };
};
