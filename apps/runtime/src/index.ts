import { WorkerEntrypoint } from "cloudflare:workers";

import type { CaseState, CaseView, ReviewNote } from "./case-runtime.ts";
import { agentWorker } from "./dispatch.ts";
import type { CaseKey, Deployment, Env, StartCase } from "./env.ts";
import type { WriteResult } from "./schema-state.ts";

export { CaseRuntime } from "./case-runtime.ts";
export { McpBroker } from "./mcp.ts";
export type { Approval } from "./approvals.ts";
export type { CaseState, CaseView, ReviewNote, WriteResult };

type Edit = { path: string; version: number; userId: string };

// Capture events and answers carry arbitrary JSON, which RPC's types cannot
// express, so the stub is typed by the object's own methods.
type CaseObject = {
  start(start: StartCase): Promise<CaseView>;
  view(): Promise<CaseView>;
  state(): Promise<CaseState>;
  rerun(notes: ReviewNote[]): Promise<CaseState>;
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

  rerun(c: CaseKey & { notes?: ReviewNote[] }) {
    return runtimeFor(this.env, c).rerun(c.notes ?? []);
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

  // The deployed Worker's manifest, read through the same dispatch path a
  // case uses. The deploy path calls this to learn what the code declares.
  async manifest(deployment: Deployment): Promise<unknown> {
    const response = await agentWorker(this.env, deployment).fetch("/manifest");
    if (!response.ok)
      throw new Error(
        `agent Worker ${deployment.script} answered ${response.status}`,
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
