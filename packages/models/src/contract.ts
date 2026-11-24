import { z } from "zod";

// Wire formats of the two model services (design doc 07). The decision model
// speaks Baseten's System One API
// (docs.baseten.co/reference/inference-api/system-one); the OCR model speaks
// OpenAI chat completions as vLLM serves LightOn OCR 3 4B. apps/model-stub
// validates requests with these same schemas, so the client cannot come to
// rely on a looser stub.

export const models = {
  decide: "groundhog-1",
  ocr: "lightonai/LightOnOCR-3-4B",
} as const;

export const systemOneLimits = {
  choiceOptions: 255,
  scoreLevels: 10,
  requestOptions: 512,
  images: 16,
} as const;

const description = z.union([
  z.string(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
  z.null(),
]);

const imagePart = z.strictObject({
  type: z.literal("image_url"),
  image_url: z.strictObject({
    url: z
      .string()
      .refine(
        (url) =>
          /^data:image\/(png|jpeg|webp);base64,/.test(url) ||
          /^https:\/\/[^/]*(\.amazonaws\.com|storage\.googleapis\.com|\.blob\.core\.windows\.net)\//.test(
            url,
          ),
        "Image URL must be a base64 PNG, JPEG or WebP data URL, or an HTTPS URL on S3, Google Cloud Storage or Azure Blob Storage",
      ),
    detail: z.literal("auto").optional(),
  }),
});
const textPart = z.strictObject({ type: z.literal("text"), text: z.string() });

const message = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.literal("user"),
    content: z.union([z.string(), z.array(z.union([textPart, imagePart]))]),
  }),
  z.strictObject({
    role: z.literal("assistant"),
    content: z.union([z.string(), z.array(textPart)]),
  }),
]);

const conversation = z.strictObject({ messages: z.array(message).min(1) });

const state = z.union([
  z.string(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()).check((ctx) => {
    if (!("messages" in ctx.value)) return;
    const parsed = conversation.safeParse(ctx.value);
    for (const issue of parsed.error?.issues ?? [])
      ctx.issues.push({
        code: "custom",
        message: issue.message,
        path: issue.path,
        input: ctx.value,
      });
  }),
]);

const instructions = description.optional();

export const systemOneQuestion = z.discriminatedUnion(
  "type",
  [
    z.strictObject({
      type: z.literal("choice"),
      instructions,
      criteria: z.record(z.string().min(1), description).refine((options) => {
        const count = Object.keys(options).length;
        return count >= 1 && count <= systemOneLimits.choiceOptions;
      }, `A choice question needs 1 to ${systemOneLimits.choiceOptions} options`),
    }),
    z.strictObject({
      type: z.literal("noul"),
      instructions,
      criteria: z
        .union([
          z.strictObject({ true: description, false: description }),
          z.strictObject({}),
          z.null(),
        ])
        .optional(),
    }),
    z.strictObject({
      type: z.literal("score"),
      instructions,
      criteria: z.array(description).min(1).max(systemOneLimits.scoreLevels),
    }),
  ],
  { error: "Question type must be choice, noul or score" },
);
export type SystemOneQuestion = z.infer<typeof systemOneQuestion>;

export const optionCount = (question: SystemOneQuestion) =>
  question.type === "noul"
    ? 2
    : question.type === "choice"
      ? Object.keys(question.criteria).length
      : question.criteria.length;

const imageCount = (value: unknown): number => {
  if (Array.isArray(value))
    return (value as unknown[]).reduce<number>((n, v) => n + imageCount(v), 0);
  if (value === null || typeof value !== "object") return 0;
  if ((value as { type?: unknown }).type === "image_url") return 1;
  return Object.values(value).reduce<number>((n, v) => n + imageCount(v), 0);
};

export const systemOneRequest = z
  .strictObject({
    model: z.string().min(1),
    service_tier: z.enum(["default", "flex", "priority"]).optional(),
    state,
    questions: z
      .record(z.string().min(1), systemOneQuestion)
      .refine(
        (questions) => Object.keys(questions).length > 0,
        "questions must not be empty",
      ),
    max_len: z.int().positive().optional(),
  })
  .check((ctx) => {
    const options = Object.values(ctx.value.questions).reduce(
      (n, question) => n + optionCount(question),
      0,
    );
    if (options > systemOneLimits.requestOptions)
      ctx.issues.push({
        code: "custom",
        message: `A request supports at most ${systemOneLimits.requestOptions} options across all questions; this one has ${options}`,
        path: ["questions"],
        input: ctx.value,
      });
    if (imageCount(ctx.value.state) > systemOneLimits.images)
      ctx.issues.push({
        code: "custom",
        message: `A request accepts at most ${systemOneLimits.images} images`,
        path: ["state"],
        input: ctx.value,
      });
  });
export type SystemOneRequest = z.infer<typeof systemOneRequest>;

const probabilities = z.record(z.string(), z.number().min(0).max(1));

export const systemOneAnswer = z.discriminatedUnion("type", [
  z.looseObject({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities,
    confidence: z.number().optional(),
  }),
  z.looseObject({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
  z.looseObject({
    type: z.literal("score"),
    score: z.number(),
    legend: z.record(z.string(), z.unknown()),
    probabilities,
    confidence: z.number().optional(),
  }),
]);
export type SystemOneAnswer = z.infer<typeof systemOneAnswer>;

export const systemOneResponse = z.looseObject({
  model: z.string(),
  answers: z.record(z.string(), systemOneAnswer),
  usage: z.looseObject({
    input_tokens: z.int().nonnegative(),
    output_tokens: z.int().nonnegative().optional(),
  }),
});
export type SystemOneResponse = z.infer<typeof systemOneResponse>;

// OCR: one page per request, a PNG data URL (longest edge 2048 px) and a text
// part selecting the mode: "" for Markdown, "grounding" for labelled blocks.
export const ocrModes = ["", "grounding"] as const;
export type OcrMode = (typeof ocrModes)[number];

export const ocrRequest = z.strictObject({
  model: z.string().min(1),
  messages: z
    .tuple([
      z.strictObject({
        role: z.literal("user"),
        content: z.tuple([
          z.strictObject({
            type: z.literal("image_url"),
            image_url: z.strictObject({
              url: z
                .string()
                .regex(
                  /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
                  "image_url.url must be a base64 PNG, JPEG or WebP data URL",
                ),
            }),
          }),
          z.strictObject({ type: z.literal("text"), text: z.enum(ocrModes) }),
        ]),
      }),
    ])
    .describe("one user message: the page image, then the mode"),
  max_tokens: z.int().positive().optional(),
  temperature: z.number().min(0).optional(),
});
export type OcrRequest = z.infer<typeof ocrRequest>;

export const chatCompletion = z.looseObject({
  id: z.string(),
  object: z.literal("chat.completion"),
  model: z.string(),
  choices: z
    .array(
      z.looseObject({
        index: z.int(),
        message: z.looseObject({
          role: z.literal("assistant"),
          content: z.string().nullable(),
        }),
        finish_reason: z.string().nullable(),
      }),
    )
    .min(1),
  usage: z
    .looseObject({
      prompt_tokens: z.int().nonnegative(),
      completion_tokens: z.int().nonnegative(),
    })
    .optional(),
});
export type ChatCompletion = z.infer<typeof chatCompletion>;
