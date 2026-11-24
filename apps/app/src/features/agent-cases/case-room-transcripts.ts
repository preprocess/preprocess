import type { UIMessage } from "ai";

import type { ScenarioState } from "../../scenarios/scenarios";

export type CaseRoomScenario = ScenarioState<"case-room">;

const ASK: UIMessage = {
  id: "msg_seed_user_1",
  role: "user",
  parts: [
    {
      type: "text",
      text: "Pull the counterparties out of the vendor pack and flag anything missing.",
    },
  ],
};

const ANSWER: UIMessage = {
  id: "msg_seed_agent_1",
  role: "assistant",
  parts: [
    {
      type: "reasoning",
      text: "The pack has a cover memo, the MSA, and two exhibits. Read the MSA first for party names.",
      state: "done",
    },
    {
      type: "dynamic-tool",
      toolCallId: "call_seed_ls",
      toolName: "bash",
      input: { command: "ls /workspace/inputs" },
      state: "output-available",
      output: "cover-memo.pdf\nmsa.docx\nexhibit-a.xlsx\nexhibit-c.pdf\n",
    },
    {
      type: "dynamic-tool",
      toolCallId: "call_seed_read",
      toolName: "read",
      input: { file_path: "/workspace/inputs/msa.docx" },
      state: "output-available",
      output:
        "MASTER SERVICES AGREEMENT between Acme Corp. and Globex Logistics LLC…",
    },
    {
      type: "text",
      text: [
        "Two counterparties are named in the MSA:",
        "",
        "| Party | Role |",
        "| --- | --- |",
        "| Acme Corp. | Customer |",
        "| Globex Logistics LLC | Vendor |",
        "",
        "**Missing:** Exhibit B (pricing) is referenced in §4.2 but is not in the pack.",
      ].join("\n"),
    },
  ],
};

/** Seeded case room conversation. There is no agent runtime yet. */
export const SEEDED_TRANSCRIPT: readonly UIMessage[] = [ASK, ANSWER];

const FOLLOW_UP: UIMessage = {
  id: "msg_seed_user_2",
  role: "user",
  parts: [{ type: "text", text: "Draft the follow-up asking for Exhibit B." }],
};

export type CaseRoomTranscript = {
  readonly messages: readonly UIMessage[];
  /** The agent is still answering the last message. */
  readonly streaming: boolean;
};

export function caseRoomTranscript(
  scenario: CaseRoomScenario,
): CaseRoomTranscript {
  switch (scenario) {
    case "conversation":
      return { messages: SEEDED_TRANSCRIPT, streaming: false };
    case "empty":
      return { messages: [], streaming: false };
    case "streaming":
      return { messages: [...SEEDED_TRANSCRIPT, FOLLOW_UP], streaming: true };
    default: {
      const exhaustive: never = scenario;
      return exhaustive;
    }
  }
}

/** Canned reply for messages sent while browsing a seeded room. */
export function seededReply(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "This room is seeded. No agent runtime is connected yet, so replies are canned.",
      },
    ],
  };
}
