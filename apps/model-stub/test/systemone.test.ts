import { ROUTES } from "@preprocess/models/endpoints";
import { describe, expect, it } from "vitest";

import { post } from "./harness.ts";

const request = (overrides: Record<string, unknown> = {}) => ({
  model: ROUTES.decide.model,
  state: "Invoice 1042 from Northwind for freight and shipping",
  questions: {
    route: {
      type: "choice",
      criteria: {
        freight: "Freight and shipping costs",
        software: "Software licences",
        travel: "Travel and lodging",
      },
    },
  },
  ...overrides,
});

const error = async (response: Response) =>
  (await response.json<{ error: string; error_type: string }>()).error;

describe("POST /v1/systemone validation", () => {
  it("requires a bearer token", async () => {
    expect((await post("/v1/systemone", request(), "")).status).toBe(401);
  });

  it("rejects a body that is not JSON with 400", async () => {
    expect((await post("/v1/systemone", "{", "test")).status).toBe(400);
  });

  it.each([
    ["a number state", { state: 42 }],
    ["a boolean state", { state: true }],
    ["a null state", { state: null }],
    ["an unknown field", { temperature: 0 }],
    ["no questions", { questions: {} }],
    [
      "an unknown question type",
      { questions: { q: { type: "rank", criteria: ["a"] } } },
    ],
    [
      "a role other than user or assistant",
      { state: { messages: [{ role: "system", content: "hi" }] } },
    ],
    [
      "an image in an assistant message",
      {
        state: {
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "image_url",
                  image_url: { url: "data:image/png;base64,AAAA" },
                },
              ],
            },
          ],
        },
      },
    ],
    [
      "more than 16 images",
      {
        state: {
          messages: [
            {
              role: "user",
              content: Array.from({ length: 17 }, () => ({
                type: "image_url",
                image_url: { url: "data:image/png;base64,AAAA" },
              })),
            },
          ],
        },
      },
    ],
    [
      "an image on another host",
      {
        state: {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: "https://example.com/page.png" },
                },
              ],
            },
          ],
        },
      },
    ],
    [
      "a choice with 256 options",
      {
        questions: {
          q: {
            type: "choice",
            criteria: Object.fromEntries(
              Array.from({ length: 256 }, (_, i) => [`o${i}`, null]),
            ),
          },
        },
      },
    ],
    [
      "more than 512 options in a request",
      {
        questions: Object.fromEntries(
          [0, 1, 2].map((q) => [
            `q${q}`,
            {
              type: "choice",
              criteria: Object.fromEntries(
                Array.from({ length: 200 }, (_, i) => [`o${i}`, null]),
              ),
            },
          ]),
        ),
      },
    ],
    [
      "a score with 11 levels",
      {
        questions: {
          q: { type: "score", criteria: Array.from({ length: 11 }, String) },
        },
      },
    ],
  ])("rejects %s with 422", async (_, overrides) => {
    const response = await post("/v1/systemone", request(overrides));
    expect(response.status).toBe(422);
    expect(await error(response)).not.toBe("");
  });

  it("names the question types in its error", async () => {
    const response = await post(
      "/v1/systemone",
      request({ questions: { q: { type: "rank" } } }),
    );
    expect(await error(response)).toContain(
      "Question type must be choice, noul or score",
    );
  });

  it("accepts conversations with images and counts noul as two options", async () => {
    const response = await post(
      "/v1/systemone",
      request({
        state: {
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Is this a refund request?" },
                {
                  type: "image_url",
                  image_url: { url: "data:image/png;base64,AAAA" },
                },
              ],
            },
          ],
        },
        questions: Object.fromEntries(
          Array.from({ length: 256 }, (_, i) => [`q${i}`, { type: "noul" }]),
        ),
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("POST /v1/systemone answers", () => {
  it("answers choice, noul and score in Baseten's shape", async () => {
    const response = await post(
      "/v1/systemone",
      request({
        questions: {
          route: request().questions.route,
          refund: {
            type: "noul",
            criteria: {
              true: "asks for money back",
              false: "about freight shipping",
            },
          },
          urgency: {
            type: "score",
            criteria: ["Routine invoice", "Needs attention today", "Emergency"],
          },
        },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      model: string;
      answers: Record<string, Record<string, unknown>>;
      usage: { input_tokens: number; output_tokens: number };
    }>();
    expect(body.model).toBe("stub-groundhog");
    expect(body.usage.output_tokens).toBe(3);
    expect(body.usage.input_tokens).toBeGreaterThan(0);

    const route = body.answers.route as {
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
    };
    expect(route.choice).toBe("freight");
    expect(
      Object.values(route.probabilities).reduce((a, b) => a + b),
    ).toBeCloseTo(1, 4);
    expect(route.confidence).toBeGreaterThan(0);

    expect(body.answers.refund).toMatchObject({ type: "noul" });
    expect(body.answers.refund?.noul).toBeLessThan(0.5);

    expect(body.answers.urgency).toMatchObject({
      type: "score",
      legend: { "0": "Routine invoice" },
    });
    expect(body.answers.urgency?.score).toBeLessThan(1);
  });

  it("gives the same answer to the same request", async () => {
    const [a, b] = await Promise.all([
      post("/v1/systemone", request()).then((r) => r.text()),
      post("/v1/systemone", request()).then((r) => r.text()),
    ]);
    expect(a).toBe(b);
  });

  it("answers from a fixture when one matches", async () => {
    const response = await post(
      "/v1/systemone",
      request({
        state: "Invoice from Acme Corporation",
        questions: {
          pick: {
            type: "choice",
            criteria: { acme: "Acme", globex: "Globex", initech: "Initech" },
          },
        },
      }),
    );
    const body = await response.json<{
      answers: {
        pick: { choice: string; probabilities: Record<string, number> };
      };
    }>();
    expect(body.answers.pick.choice).toBe("acme");
    expect(body.answers.pick.probabilities.acme).toBe(0.93);
  });
});
