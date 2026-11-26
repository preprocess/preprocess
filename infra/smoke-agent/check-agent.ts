// The agent the staging model check deploys once per model: an invoice with
// a vendor list, so a run reads its file through OCR, picks the vendor with
// decide and answers. MODEL is set by scripts/model-check.ts when it bundles.

import { agent, schema as s } from "@preprocess/sdk";

declare const MODEL:
  | "kimi-k3.1-pro"
  | "deepseek-v4.1-flash"
  | "deepseek-v4.1-flash-fast"
  | "qwen3.8-27b";

export default agent({
  instructions:
    "You read one invoice. Use decide to choose the vendor, answer the amount, and finish. Keep every reply to one sentence.",
  model: MODEL,
  reasoning: "low",
  ocr: true,
  schema: s.group({
    vendor: s.select({
      description: "Vendor that issued the invoice",
      options: [
        { id: "acme", label: "Acme Corporation" },
        { id: "globex", label: "Globex", description: "Industrial supplies" },
        { id: "initech", label: "Initech", description: "Software" },
      ],
      review: "none",
    }),
    amount: s.number({ description: "Total due", review: "none" }),
  }),
  tools: {},
});
