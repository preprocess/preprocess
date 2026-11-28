import { WorkerEntrypoint } from "cloudflare:workers";

import { captureKey, type RunCapture } from "./capture.ts";
import type { CaseState, CaseView, ReviewNote } from "./case-runtime.ts";
import { agentWorker, storeBundle, type Bundle } from "./dispatch.ts";
import type {
  CaseKey,
  Deployment,
  DeploymentRef,
  Env,
  MemoryRule,
  StartCase,
} from "./env.ts";
import {
  layerBuilderName,
  layerPrefix,
  ownsLayer,
  type LayerJob,
} from "./layers.ts";
import type { WriteResult } from "./schema-state.ts";

export { CaseRuntime } from "./case-runtime.ts";
export { McpBroker } from "./mcp.ts";
export type { Approval } from "./approvals.ts";
export { Outbound } from "./outbound.ts";
export { SandboxLarge, SandboxMedium, SandboxSmall } from "./sandbox.ts";
export type { CaseState, CaseView, ReviewNote, WriteResult };

type Edit = { path: string; version: number; userId: string };

// Capture events and answers carry arbitrary JSON, which RPC's types cannot
// express, so the stub is typed by the object's own methods.
type CaseObject = {
  start(start: StartCase): Promise<CaseView>;
  view(): Promise<CaseView>;
  state(): Promise<CaseState>;
  rerun(notes: ReviewNote[], memories?: MemoryRule[]): Promise<CaseState>;
  edit(input: Edit & { value: unknown }): Promise<unknown>;
  confirm(input: Edit): Promise<unknown>;
  acceptSuggestion(input: Edit): Promise<unknown>;
  options(input: {
    path: string;
    query?: string;
    cursor?: string;
    limit?: number;
  }): Promise<unknown>;
  message(input: { userId: string; text: string }): Promise<{
    id: string;
    mentioned: string[];
  }>;
  cancel(): Promise<CaseState>;
  dropCapture(): Promise<void>;
  wipe(): Promise<void>;
  complete(): Promise<
    | { result: "ok"; state: CaseState }
    | { result: "refused"; code: string; message: string }
  >;
  decide(input: {
    id: string;
    approve: boolean;
    userId: string;
    note: string | null;
  }): Promise<CaseState>;
};

const runtimeFor = (env: Env, c: CaseKey) =>
  env.CASE_RUNTIME.getByName(
    `${c.organizationId}:${c.agentId}:${c.caseId}`,
  ) as unknown as CaseObject;

// The runtime's RPC surface for the platform's other Workers. The API starts
// cases here once it has resolved the deployment, and relays what people do
// in the case room.
export default class Runtime extends WorkerEntrypoint<Env> {
  startCase(start: StartCase) {
    return runtimeFor(this.env, start).start(start);
  }

  getCase(c: CaseKey) {
    return runtimeFor(this.env, c).view();
  }

  caseState(c: CaseKey) {
    return runtimeFor(this.env, c).state();
  }

  rerun(c: CaseKey & { notes?: ReviewNote[]; memories?: MemoryRule[] }) {
    return runtimeFor(this.env, c).rerun(c.notes ?? [], c.memories);
  }

  editAnswer(c: CaseKey & Edit & { value: unknown }) {
    return runtimeFor(this.env, c).edit(c);
  }

  confirmAnswer(c: CaseKey & Edit) {
    return runtimeFor(this.env, c).confirm(c);
  }

  acceptSuggestion(c: CaseKey & Edit) {
    return runtimeFor(this.env, c).acceptSuggestion(c);
  }

  searchOptions(
    c: CaseKey & {
      path: string;
      query?: string;
      cursor?: string;
      limit?: number;
    },
  ) {
    return runtimeFor(this.env, c).options(c);
  }

  postMessage(c: CaseKey & { userId: string; text: string }) {
    return runtimeFor(this.env, c).message(c);
  }

  cancelCase(c: CaseKey) {
    return runtimeFor(this.env, c).cancel();
  }

  completeCase(c: CaseKey) {
    return runtimeFor(this.env, c).complete();
  }

  // Retention (spec 16a), for closed cases only: the case's run capture in
  // RUNS and in its object, or the whole object and its capture. Both are
  // safe to repeat.
  async deleteCapture(c: CaseKey) {
    await this.env.RUNS.delete(captureKey(c));
    await runtimeFor(this.env, c).dropCapture();
  }

  // A closed case's run capture as stored (design doc 10), or null when there
  // is none. The API reads it here so RUNS keeps one owner.
  async readCapture(c: CaseKey): Promise<RunCapture | null> {
    const object = await this.env.RUNS.get(captureKey(c));
    return object ? object.json<RunCapture>() : null;
  }

  async deleteCase(c: CaseKey) {
    await this.env.RUNS.delete(captureKey(c));
    await runtimeFor(this.env, c).wipe();
  }

  // Deleting an organization (the API's purge.ts): up to `pages` listings of
  // its objects in RUNS and BUNDLES (custom environment layers included),
  // deleted. Safe to repeat; done once nothing is left under its prefixes.
  async deleteOrganizationObjects(organizationId: string, pages: number) {
    if (!/^[\w-]+$/.test(organizationId))
      throw new Error(`refusing to purge objects of "${organizationId}"`);
    const deleted = { runs: 0, bundles: 0 };
    const prefixes = [
      { bucket: this.env.RUNS, prefix: `${organizationId}/`, count: "runs" },
      {
        bucket: this.env.BUNDLES,
        prefix: `${organizationId}/`,
        count: "bundles",
      },
      {
        bucket: this.env.BUNDLES,
        prefix: layerPrefix(organizationId),
        count: "bundles",
      },
    ] as const;
    for (const { bucket, prefix, count } of prefixes)
      for (;;) {
        if (pages-- <= 0) return { ...deleted, done: false };
        const page = await bucket.list({ prefix });
        if (!page.objects.length) break;
        await bucket.delete(page.objects.map((o) => o.key));
        deleted[count] += page.objects.length;
      }
    return { ...deleted, done: true };
  }

  decideApproval(
    c: CaseKey & {
      id: string;
      approve: boolean;
      userId: string;
      note: string | null;
    },
  ) {
    return runtimeFor(this.env, c).decide(c);
  }

  // A new deployment's code (design doc 03): stored where the loader reads
  // it, returning the SHA-256 every load is checked against.
  putBundle(deployment: DeploymentRef, bundle: Bundle): Promise<string> {
    return storeBundle(this.env, deployment, bundle);
  }

  // A deploy's custom environment (spec 3), built on the largest sandbox
  // class; the result comes back through the platform's sandboxLayerBuilt.
  async queueSandboxLayer(job: LayerJob, deployment: DeploymentRef) {
    await this.env.SANDBOX_LARGE.getByName(
      await layerBuilderName(job),
    ).queueLayer({ job, waiting: [deployment] });
  }

  // Garbage collection of a layer no live deployment names. Only keys under
  // the organization's own prefix are deleted; it answers whether it was.
  async deleteSandboxLayer(organizationId: string, key: string) {
    if (!ownsLayer(organizationId, key)) return false;
    await this.env.BUNDLES.delete(key);
    return true;
  }

  // The deployed Worker's manifest, read through the same dispatch path a
  // case uses. The deploy path calls this to learn what the code declares.
  async manifest(deployment: Deployment): Promise<unknown> {
    const response = await agentWorker(this.env, deployment, this.ctx).fetch(
      "/manifest",
    );
    if (!response.ok)
      throw new Error(
        `agent code of ${deployment.deploymentId} answered ${response.status}`,
      );
    return response.json();
  }

  // Local development only, until the cases API serves it: start and read a
  // case by HTTP so a deployed agent can be run end to end.
  override async fetch(request: Request) {
    if (this.env.STAGE !== "development")
      return new Response("not found", { status: 404 });
    const url = new URL(request.url);
    const [, dev, org, agent, caseId] = url.pathname.split("/");
    if (dev !== "dev" || !org || !agent || !caseId)
      return new Response("not found", { status: 404 });
    if (request.method === "POST") {
      const body =
        await request.json<
          Omit<StartCase, "organizationId" | "agentId" | "caseId">
        >();
      return Response.json(
        await this.startCase({
          ...body,
          organizationId: org,
          agentId: agent,
          caseId,
        }),
        { status: 202 },
      );
    }
    return Response.json(
      await this.getCase({ organizationId: org, agentId: agent, caseId }),
    );
  }
}
