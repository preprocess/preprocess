import type { Env } from "./env.ts";

// The staging model service (PLAT-31) does not exist yet. Until
// MODEL_SERVICE_URL is set, this stub answers in the OpenAI chat shape the
// real service will use, so callers don't change when it lands.
export async function chat(env: Env, body: unknown): Promise<Response> {
  if (!env.MODEL_SERVICE_URL) {
    return Response.json({
      id: "stub",
      object: "chat.completion",
      model: "stub",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              "Stubbed reply: MODEL_SERVICE_URL is unset, so no model was called.",
          },
          finish_reason: "stop",
        },
      ],
    });
  }
  return fetch(new URL("/v1/chat/completions", env.MODEL_SERVICE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.MODEL_SERVICE_KEY ?? ""}`,
    },
    body: JSON.stringify(body),
  });
}
