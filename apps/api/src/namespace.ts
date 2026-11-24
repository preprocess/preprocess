// The Workers for Platforms script API, as far as deploys and secret delivery
// need it (design doc 03). Deployed stages call Cloudflare's API for the
// stage's dispatch namespace; locally, apps/namespace-local takes the same
// calls, because Cloudflare's local runtime cannot emulate a namespace.

import type { Env } from "./env.ts";

export type ScriptBinding =
  | { type: "secret_text" | "plain_text"; name: string; text: string }
  | {
      type: "service";
      name: string;
      service: string;
      entrypoint?: string;
      props?: Record<string, unknown>;
    };

export type ScriptUpload = {
  mainModule: string;
  modules: Record<string, string>;
  bindings: ScriptBinding[];
  tags: string[];
};

export type Namespace = {
  putScript(name: string, upload: ScriptUpload): Promise<unknown>;
  putSecret(name: string, secret: { name: string; text: string }): Promise<void>;
  deleteSecret(name: string, secretName: string): Promise<void>;
};

// Agent scripts run with the platform's compatibility settings, not their
// own, so every deployment of every SDK version sees the same runtime.
export const AGENT_COMPATIBILITY = {
  date: "2026-07-26",
  flags: ["nodejs_compat"],
};

const cloudflare = (env: Env): Namespace => {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, DISPATCH_NAMESPACE: namespace } = env;
  if (!account || !token || !namespace)
    throw new Error("no dispatch namespace is configured for deploys");
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/dispatch/namespaces/${namespace}/scripts`;
  const call = async (path: string, init: RequestInit) => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
    const body = await response.json<{ success: boolean; errors?: Array<{ message: string }> }>();
    if (!response.ok || !body.success)
      throw new Error(
        `Cloudflare ${response.status}: ${(body.errors ?? []).map((e) => e.message).join("; ")}`,
      );
  };
  return {
    putScript: (name, upload) => {
      const form = new FormData();
      form.append(
        "metadata",
        new Blob(
          [
            JSON.stringify({
              main_module: upload.mainModule,
              compatibility_date: AGENT_COMPATIBILITY.date,
              compatibility_flags: AGENT_COMPATIBILITY.flags,
              bindings: upload.bindings,
              tags: upload.tags,
            }),
          ],
          { type: "application/json" },
        ),
      );
      for (const [file, source] of Object.entries(upload.modules))
        form.append(file, new Blob([source], { type: "application/javascript+module" }), file);
      return call(`/${name}`, { method: "PUT", body: form });
    },
    putSecret: (name, secret) =>
      call(`/${name}/secrets`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...secret, type: "secret_text" }),
      }),
    deleteSecret: (name, secretName) =>
      call(`/${name}/secrets/${encodeURIComponent(secretName)}`, { method: "DELETE" }),
  };
};

export const namespaceFor = (env: Env): Namespace =>
  env.LOCAL_NAMESPACE ?? cloudflare(env);
