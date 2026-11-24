import {
  callModel,
  type CallOptions,
  type ModelEndpoint,
  ModelError,
} from "./client.ts";
import { systemOneLimits, systemOneResponse } from "./contract.ts";

export type DecideOption = { id: string; label: string; description?: string };

export type DecideInput = {
  prompt: string;
  // Case context the runtime passes: input text and relevant answers.
  case?: unknown;
  options: DecideOption[];
  keep?: number;
};

export type DecideResult = {
  picks: Array<{ id: string; probability: number }>;
  usage: { model: string; inputTokens: number; requests: number };
};

// Each chunk of a long list keeps at least this many survivors for the next
// round, so a close call is never decided inside one chunk.
const survivorsPerChunk = 8;

type Usage = DecideResult["usage"];

async function ask(
  endpoint: ModelEndpoint,
  input: DecideInput,
  options: DecideOption[],
  usage: Usage,
  call: CallOptions,
) {
  const response = await callModel(
    endpoint,
    "/v1/systemone",
    {
      model: endpoint.model,
      state: { prompt: input.prompt, case: input.case ?? null },
      questions: {
        pick: {
          type: "choice",
          criteria: Object.fromEntries(
            options.map((option) => [
              option.id,
              option.description
                ? `${option.label}: ${option.description}`
                : option.label,
            ]),
          ),
        },
      },
    },
    systemOneResponse,
    call,
  );
  usage.model = response.model;
  usage.inputTokens += response.usage.input_tokens;
  usage.requests += 1;
  const answer = response.answers.pick;
  if (answer?.type !== "choice")
    throw new ModelError("upstream_error", "Model service did not answer pick");
  return options
    .map((option) => ({
      id: option.id,
      probability: answer.probabilities[option.id] ?? 0,
    }))
    .sort((a, b) => b.probability - a.probability);
}

// decide({ prompt, options, keep }) on the decision model (design doc 07): one
// choice question, the top `keep` options by probability. A list longer than
// one question allows runs in rounds: chunks go out in parallel, each keeps its
// best max(keep, 8), and the survivors are decided again until one request
// holds them all.
export async function decide(
  endpoint: ModelEndpoint,
  input: DecideInput,
  call: CallOptions = {},
): Promise<DecideResult> {
  const keep = input.keep ?? 1;
  const max = systemOneLimits.choiceOptions;
  if (input.options.length === 0)
    throw new ModelError("invalid_request", "decide needs at least one option");
  if (!Number.isInteger(keep) || keep < 1 || keep > max)
    throw new ModelError(
      "invalid_request",
      `keep must be an integer from 1 to ${max}`,
    );
  if (new Set(input.options.map((o) => o.id)).size !== input.options.length)
    throw new ModelError("invalid_request", "decide option ids must be unique");

  const usage: Usage = { model: endpoint.model, inputTokens: 0, requests: 0 };
  let remaining = input.options;
  while (remaining.length > max) {
    const chunks: DecideOption[][] = [];
    for (let i = 0; i < remaining.length; i += max)
      chunks.push(remaining.slice(i, i + max));
    const ranked = await Promise.all(
      chunks.map((chunk) => ask(endpoint, input, chunk, usage, call)),
    );
    const survivors = new Set(
      ranked.flatMap((picks) =>
        picks.slice(0, Math.max(keep, survivorsPerChunk)).map((p) => p.id),
      ),
    );
    remaining = remaining.filter((option) => survivors.has(option.id));
  }
  const picks = await ask(endpoint, input, remaining, usage, call);
  return { picks: picks.slice(0, keep), usage };
}
