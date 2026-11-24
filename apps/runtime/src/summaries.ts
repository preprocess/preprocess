import type { Message } from "@earendil-works/pi-ai";
import {
  CompactionTask,
  defineExtension,
  hook,
} from "@earendil-works/pi-durable";
import type { Reasoning } from "@preprocess/sdk/protocol";

import { type openModels, PROVIDER } from "./models.ts";

// Spec 3: context is handled with large summaries, not progressive
// compaction. Pi never compacts in the background. Only when a request would
// leave less than reserveTokens of the window does it summarize everything but
// the newest few thousand tokens, once, into one large summary written by the
// hook below. Pi's own short summary is the fallback when that call fails.
export const COMPACTION = {
  enabled: true,
  reserveTokens: 65536,
  keepRecentTokens: 8192,
  backgroundTokens: 0,
};

export const SUMMARY_TOKENS = 32768;

const SYSTEM =
  "You write the working memory of an agent that is part-way through a case. You read the case so far and write it down so the agent can carry on from your text alone. Do not continue the case and do not answer anything in it.";

const PROMPT = `Write a complete account of the case above. The agent will lose everything before this point except what you write, so length is not a concern: keep detail rather than compress it.

- The case's input and every instruction or correction a person gave, close to word for word.
- Every fact the agent learned from tools, files and documents, with exact values: identifiers, amounts, dates, names, addresses, quotes. Keep tool results that bear on the case in full.
- What the agent has done, in order, which tool calls failed and why, and what it decided and why.
- What is still open and what the agent was about to do.

If the case starts with an earlier summary, keep all of it and add the newer events.`;

const content = (message: Message) => {
  if (typeof message.content === "string") return message.content;
  return message.content
    .flatMap((part) =>
      part.type === "text"
        ? [part.text]
        : part.type === "toolCall"
          ? [`call ${part.name} ${JSON.stringify(part.arguments)}`]
          : [],
    )
    .join("\n");
};

export const transcript = (messages: readonly Message[]) =>
  messages
    .flatMap((message) => {
      const text = content(message);
      if (!text || message.role === "system") return [];
      if (message.role === "user") return [`[Case]: ${text}`];
      if (message.role === "assistant") return [`[Agent]: ${text}`];
      return [
        `[${message.toolName}${message.isError ? " failed" : ""}]: ${text}`,
      ];
    })
    .join("\n\n");

export const largeSummaries = (
  models: ReturnType<typeof openModels>,
  modelId: string,
  reasoning: Reasoning,
  record: (data: Record<string, unknown>) => void,
) =>
  defineExtension({
    name: "summaries",
    hooks: [
      hook(CompactionTask, {
        beforeCompact: async (compaction) => {
          const model = models.getModel(PROVIDER, modelId);
          if (!model) return undefined;
          const started = Date.now();
          const message = await models.completeSimple(
            model,
            {
              systemPrompt: SYSTEM,
              messages: [
                {
                  role: "user",
                  content: `<case>\n${transcript(compaction.messages)}\n</case>\n\n${PROMPT}`,
                  timestamp: started,
                },
              ],
            },
            { maxTokens: SUMMARY_TOKENS, reasoning },
          );
          const summary = message.content
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("")
            .trim();
          const error =
            message.stopReason !== "stop" || !summary
              ? (message.errorMessage ?? `stopped: ${message.stopReason}`)
              : undefined;
          record({
            reason: compaction.reason,
            entries: compaction.entries.length,
            ms: Date.now() - started,
            usage: message.usage,
            ...(error ? { error } : { chars: summary.length }),
          });
          return error ? undefined : { summary };
        },
      }),
    ],
  });
