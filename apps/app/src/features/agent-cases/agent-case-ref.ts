/** Product agent identity. Not the Flue Worker mount segment. */
export type AgentId = string & { readonly __brand: "AgentId" };

/** Product case identity. Not inspect CaseData.id. */
export type CaseId = string & { readonly __brand: "CaseId" };

/**
 * Flue instance id (`FlueAgentChat` `name`).
 * Single path segment. Only construct via `conversationNameOf`.
 */
export type ConversationName = string & {
  readonly __brand: "ConversationName";
};

export type AgentCaseRef = {
  readonly agentId: AgentId;
  readonly caseId: CaseId;
};

export type AgentCaseParam = "agentId" | "caseId";

export class InvalidAgentCaseParamError extends Error {
  readonly param: AgentCaseParam;
  readonly value: string;
  constructor(param: AgentCaseParam, value: string) {
    super(`Invalid ${param}`);
    this.name = "InvalidAgentCaseParamError";
    this.param = param;
    this.value = value;
  }
}

/** 1–64 chars. Excludes `:` so `conversationNameOf` stays injective. */
const AGENT_CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function parseAgentId(raw: string): AgentId {
  if (!AGENT_CASE_ID.test(raw)) {
    throw new InvalidAgentCaseParamError("agentId", raw);
  }
  return raw as AgentId;
}

export function parseCaseId(raw: string): CaseId {
  if (!AGENT_CASE_ID.test(raw)) {
    throw new InvalidAgentCaseParamError("caseId", raw);
  }
  return raw as CaseId;
}

export function parseAgentCaseRef(raw: {
  agentId: string;
  caseId: string;
}): AgentCaseRef {
  return {
    agentId: parseAgentId(raw.agentId),
    caseId: parseCaseId(raw.caseId),
  };
}

export function stringifyAgentCaseRef(ref: AgentCaseRef): {
  agentId: string;
  caseId: string;
} {
  return { agentId: ref.agentId, caseId: ref.caseId };
}

export function conversationNameOf(ref: AgentCaseRef): ConversationName {
  return `${ref.agentId}:${ref.caseId}` as ConversationName;
}
