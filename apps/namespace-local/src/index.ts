import { WorkerEntrypoint } from "cloudflare:workers";

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

type Stored = Omit<ScriptUpload, "modules"> & { revision: number };

type OutboundParams = { organizationId: string; network: string };

type Env = {
  LOADER: WorkerLoader;
  SCRIPTS: R2Bucket;
  OUTBOUND: Fetcher & {
    fetchAs(params: OutboundParams, request: Request): Promise<Response>;
  };
  // apps/tail, attached to every script as a tail consumer is on Cloudflare.
  TAIL?: Fetcher;
};

const metaKey = (name: string) => `scripts/${name}.json`;
const modulesKey = (name: string, revision: number) =>
  `scripts/${name}/${revision}.json`;

const read = async (env: Env, name: string) =>
  (await env.SCRIPTS.get(metaKey(name)))?.json<Stored>() ?? null;

const write = (env: Env, name: string, stored: Stored) =>
  env.SCRIPTS.put(metaKey(name), JSON.stringify(stored));

// The outbound Worker for one dispatch, with that dispatch's parameters.
export class Outbound extends WorkerEntrypoint<Env, OutboundParams> {
  override fetch(request: Request) {
    return this.env.OUTBOUND.fetchAs(this.ctx.props, request);
  }
}

// The subset of the Workers for Platforms script API the deploy path uses.
export class Namespace extends WorkerEntrypoint<Env> {
  async putScript(name: string, upload: ScriptUpload) {
    const revision = ((await read(this.env, name))?.revision ?? 0) + 1;
    await this.env.SCRIPTS.put(
      modulesKey(name, revision),
      JSON.stringify(upload.modules),
    );
    const { modules: _modules, ...meta } = upload;
    await write(this.env, name, { ...meta, revision });
    return { revision };
  }

  async putSecret(name: string, secret: { name: string; text: string }) {
    const stored = await read(this.env, name);
    if (!stored) throw new Error(`script ${name} not found`);
    const bindings = stored.bindings.filter((b) => b.name !== secret.name);
    bindings.push({ type: "secret_text", ...secret });
    await this.copy(name, stored, bindings);
  }

  async deleteSecret(name: string, secretName: string) {
    const stored = await read(this.env, name);
    if (!stored) throw new Error(`script ${name} not found`);
    await this.copy(
      name,
      stored,
      stored.bindings.filter((b) => b.name !== secretName),
    );
  }

  async listSecrets(name: string) {
    const stored = await read(this.env, name);
    return (stored?.bindings ?? [])
      .filter((b) => b.type === "secret_text")
      .map((b) => b.name);
  }

  // A secret change makes a new version of the same code, as on Cloudflare.
  private async copy(name: string, stored: Stored, bindings: ScriptBinding[]) {
    const revision = stored.revision + 1;
    const modules = await this.env.SCRIPTS.get(
      modulesKey(name, stored.revision),
    );
    await this.env.SCRIPTS.put(
      modulesKey(name, revision),
      await modules!.text(),
    );
    await write(this.env, name, { ...stored, bindings, revision });
  }
}

const bindingValue = (binding: ScriptBinding) => {
  if (binding.type === "service")
    throw new Error(`service binding ${binding.name} is not supported locally`);
  return binding.text;
};

// The dispatch namespace's runtime half: runs a script with the outbound
// Worker and the props the dispatching Worker passes, as `DISPATCHER.get`
// does on Cloudflare.
export default class extends WorkerEntrypoint<Env> {
  async dispatch(
    name: string,
    outbound: OutboundParams,
    props: Record<string, unknown>,
    request: Request,
  ) {
    const stored = await read(this.env, name);
    if (!stored)
      return new Response(`Worker ${name} not found`, { status: 404 });
    const exports = this.ctx.exports as unknown as {
      Outbound(options: { props: OutboundParams }): Fetcher;
    };
    const worker = this.env.LOADER.get(
      `${name}:${stored.revision}`,
      async () => ({
        compatibilityDate: "2026-07-26",
        compatibilityFlags: ["nodejs_compat"],
        mainModule: stored.mainModule,
        modules: await (await this.env.SCRIPTS.get(
          modulesKey(name, stored.revision),
        ))!.json<Record<string, string>>(),
        env: Object.fromEntries(
          stored.bindings.map((b) => [b.name, bindingValue(b)]),
        ),
        globalOutbound: exports.Outbound({ props: outbound }),
        tails: this.env.TAIL ? [this.env.TAIL] : [],
      }),
    );
    return worker.getEntrypoint(undefined, { props }).fetch(request);
  }
}
