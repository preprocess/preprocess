/**
 * What an agent is made of, read from its deployed code: how cases reach it,
 * its instructions, tools, output, checks, and success step. Seeded per
 * agent; there is no agents backend yet, and builds outside dev serve the
 * empty definition.
 */

export const API_BASE = "https://api.preprocess.com/v1";

export type AgentTrigger =
  | { readonly kind: "api" }
  | { readonly kind: "webhook"; readonly source: string }
  | { readonly kind: "schedule"; readonly cron: string; readonly label: string }
  | { readonly kind: "email"; readonly address: string };

export type AgentTool = {
  readonly name: string;
  readonly description: string;
  /** Built into Preprocess (Rich Parse, Classify) or written in the agent's code. */
  readonly builtIn: boolean;
};

export type OutputField = {
  readonly path: string;
  readonly type: string;
  readonly description: string;
};

export type AgentDefinition = {
  readonly triggers: readonly AgentTrigger[];
  readonly instructions: string;
  readonly skills: readonly string[];
  readonly tools: readonly AgentTool[];
  readonly output: readonly OutputField[];
  /** What the verification file checks before a case can finish. */
  readonly checks: readonly string[];
  /** What runs once the checks pass. */
  readonly onSuccess: string;
};

const RICH_PARSE: AgentTool = {
  name: "Rich Parse",
  description: "Reads every incoming document into text and tables.",
  builtIn: true,
};

const CLASSIFY: AgentTool = {
  name: "Classify",
  description: "Scores text against the agent's labels.",
  builtIn: true,
};

const DEFINITIONS: Readonly<Record<string, AgentDefinition>> = {
  intake: {
    triggers: [
      { kind: "api" },
      { kind: "email", address: "intake@acme.agents.preprocess.com" },
    ],
    instructions:
      "Read each incoming pack, identify the parties and key terms, and ask Operations when a required exhibit is missing.",
    skills: ["Counterparty lookup", "Exhibit checklist"],
    tools: [
      RICH_PARSE,
      CLASSIFY,
      {
        name: "lookup_counterparty",
        description: "Finds the counterparty in the customer register.",
        builtIn: false,
      },
    ],
    output: [
      { path: "parties[]", type: "object", description: "Every party named" },
      { path: "parties[].name", type: "string", description: "Legal name" },
      { path: "terms.start", type: "date", description: "Start date" },
      { path: "terms.value", type: "money", description: "Contract value" },
      { path: "exhibits[]", type: "string", description: "Exhibits found" },
    ],
    checks: [
      "Every party matches the customer register",
      "Start date is before end date",
      "All required exhibits are present",
    ],
    onSuccess: "Files the pack and posts a summary to the case.",
  },
};

function fallback(name: string): AgentDefinition {
  return {
    triggers: [{ kind: "api" }],
    instructions: `Work each case for ${name} and ask a person when something is unclear.`,
    skills: [],
    tools: [RICH_PARSE],
    output: [
      { path: "summary", type: "string", description: "What the agent found" },
    ],
    checks: ["Output matches the schema"],
    onSuccess: "Marks the case done.",
  };
}

export function agentDefinition(id: string, name: string): AgentDefinition {
  if (!import.meta.env.DEV) {
    return {
      triggers: [{ kind: "api" }],
      instructions: "",
      skills: [],
      tools: [],
      output: [],
      checks: [],
      onSuccess: "",
    };
  }
  return DEFINITIONS[id] ?? fallback(name);
}

/** Where to POST a new case for this agent. */
export function agentEndpoint(id: string) {
  return `${API_BASE}/agents/${id}/cases`;
}
