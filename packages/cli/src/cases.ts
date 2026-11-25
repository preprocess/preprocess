// `preprocess cases create` (design doc 04): start a case from files, text or
// both. Files upload first; the create carries an Idempotency-Key, so a retry
// with the same key never starts a second case.

import { readFile } from "node:fs/promises";
import path from "node:path";

export type CasesCreateOptions = {
  api: string;
  org: string;
  key: string;
  agent: string;
  text?: string | undefined;
  files?: string[] | undefined;
  deployment?: string | undefined;
  idempotencyKey?: string | undefined;
  fetch?: typeof fetch;
};

type Failure = { error?: { message?: string } };

export const casesCreate = async (options: CasesCreateOptions) => {
  const send = options.fetch ?? fetch;
  const base = options.api.endsWith("/") ? options.api : options.api + "/";
  const url = (route: string) =>
    new URL("v1/orgs/" + encodeURIComponent(options.org) + "/" + route, base);
  const call = async <T>(route: string, init: RequestInit) => {
    const response = await send(url(route), {
      ...init,
      headers: { ...init.headers, authorization: "Bearer " + options.key },
    });
    const body = (await response.json()) as T & Failure;
    if (!response.ok)
      throw new Error(
        "POST " +
          route +
          " failed (" +
          response.status +
          "): " +
          (body.error?.message ?? "unknown error"),
      );
    return body;
  };

  const files: string[] = [];
  for (const file of options.files ?? []) {
    const form = new FormData();
    form.set("file", new Blob([await readFile(file)]), path.basename(file));
    const stored = await call<{ id: string }>("files", {
      method: "POST",
      body: form,
    });
    files.push(stored.id);
  }

  const created = await call<{ id: string; statusUrl: string }>("cases", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": options.idempotencyKey ?? crypto.randomUUID(),
    },
    body: JSON.stringify({
      agent: options.agent,
      ...(options.deployment && { deployment: options.deployment }),
      ...(options.text && { text: options.text }),
      files,
    }),
  });
  return { out: "Started " + created.id + ": " + created.statusUrl };
};
