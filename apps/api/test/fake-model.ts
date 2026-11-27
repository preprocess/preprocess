// An organization's own OpenAI-compatible model server, as the API Worker sees
// it on the internet in tests (a model endpoint's test call).

export const MODEL_ORIGIN = "https://models.test";
export const MODEL_KEY = "sk-test-endpoint-4f9c";

export const fakeModel = async (request: Request) => {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/v1/chat/completions")
    return new Response("not found", { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${MODEL_KEY}`)
    return Response.json(
      { error: { message: "invalid api key" } },
      { status: 401 },
    );
  const body = await request.json<{ model: string }>();
  if (body.model === "missing")
    return Response.json(
      { error: { message: "The model `missing` does not exist." } },
      { status: 404 },
    );
  return Response.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    model: body.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "OK" },
        finish_reason: "length",
      },
    ],
  });
};
