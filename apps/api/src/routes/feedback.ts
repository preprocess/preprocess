// Feedback about Preprocess itself (PRE-164), from a person in the app or an
// agent over the API or MCP. Every item is a row in its own organization; on
// our cloud, where FEEDBACK_EMAIL_TO is set, it is also emailed to us. A
// self-hosted install keeps it and sends it nowhere.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { apikey, organization, user } from "@preprocess/db/schema/auth";
import { cases } from "@preprocess/db/schema/cases";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CLIENT_MAX,
  FEEDBACK_MESSAGE_MAX,
  feedback,
} from "@preprocess/db/schema/feedback";
import { runMode } from "@preprocess/runmode";
import { eq, or } from "drizzle-orm";

import { trackEvent } from "../analytics.ts";
import { eventBase } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import { feedbackEmail } from "../email-templates.ts";
import { emailBrand } from "../email.ts";
import type { Env } from "../env.ts";
import { feedbackRateLimit } from "../rate-limit.ts";

const OrgParam = z.object({ org: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const error = (description: string) =>
  json(
    z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
    description,
  );

const SendFeedback = z
  .object({
    category: z.enum(FEEDBACK_CATEGORIES).openapi({
      description:
        "bug: something is broken. idea: something is missing. question: something is confusing. other: anything else.",
    }),
    message: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX).openapi({
      description:
        "What you tried, what happened and what you expected, in up to 5,000 characters. No secrets or customer data.",
    }),
    agent: z
      .string()
      .max(200)
      .optional()
      .openapi({ description: "The agent it's about, by id or slug" }),
    case: z
      .string()
      .max(200)
      .optional()
      .openapi({ description: "The case it's about, by id" }),
    client: z
      .string()
      .trim()
      .min(1)
      .max(FEEDBACK_CLIENT_MAX)
      .optional()
      .openapi({
        description:
          "What is sending this, such as your MCP client's name and version",
      }),
  })
  .openapi("SendFeedback");

const FeedbackReceipt = z
  .object({ id: z.string(), createdAt: z.string() })
  .openapi("FeedbackReceipt");

export const feedbackRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>({
  defaultHook: (result, c) => {
    if (!result.success)
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: result.error.issues
              .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
              .join("; "),
          },
        },
        400,
      );
  },
}).openapi(
  createRoute({
    method: "post",
    path: "/feedback",
    tags: ["Feedback"],
    summary: "Send feedback about Preprocess",
    description:
      "Tell Preprocess when something in Preprocess itself is broken, missing or confusing: an error you can't explain, a tool or endpoint that doesn't do what its docs say, or something you needed and couldn't find. Say what you tried and what happened, and name the agent or case when there is one. Never include secrets, API keys, credentials or customer data from cases; describe the problem instead. At most 20 an hour for each API key or person.",
    request: {
      params: OrgParam,
      headers: z.object({ "x-preprocess-client": z.string().optional() }),
      body: {
        content: { "application/json": { schema: SendFeedback } },
        required: true,
      },
    },
    responses: {
      201: json(FeedbackReceipt, "Recorded"),
      400: error("Body fails validation"),
      404: error("The agent or case isn't in this organization"),
      429: error("Over 20 an hour"),
    },
  }),
  async (c) => {
    const input = c.req.valid("json");
    const { org, caller } = c.var;
    const retryAfter = await feedbackRateLimit(c.env, org, caller);
    if (retryAfter)
      return c.json(
        {
          error: {
            code: "rate_limited",
            message: `Too much feedback. Try again in ${retryAfter} seconds.`,
          },
        },
        429,
        { "retry-after": String(retryAfter) },
      );
    const header = c.req.valid("header")["x-preprocess-client"];
    const client =
      input.client ?? header?.slice(0, FEEDBACK_CLIENT_MAX) ?? null;
    const created = await withOrg(c.env, org, async (tx) => {
      let agentId: string | null = null;
      if (input.agent) {
        const [found] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(or(eq(agents.id, input.agent), eq(agents.slug, input.agent)));
        if (!found) throw new ApiError(404, "not_found", "No such agent.");
        agentId = found.id;
      }
      if (input.case) {
        const [found] = await tx
          .select({ id: cases.id })
          .from(cases)
          .where(eq(cases.id, input.case));
        if (!found) throw new ApiError(404, "not_found", "No such case.");
      }
      const [row] = await tx
        .insert(feedback)
        .values({
          id: newId("feedback"),
          organizationId: org,
          createdByUserId: caller.type === "person" ? caller.userId : null,
          apiKeyId: caller.type === "api_key" ? caller.keyId : null,
          category: input.category,
          message: input.message,
          agentId,
          caseId: input.case ?? null,
          client,
        })
        .returning();
      await audit(tx, {
        ...eventBase(c.var),
        action: "feedback.submitted",
        targetType: "feedback",
        targetId: row!.id,
        data: { category: input.category, agent: agentId, case: row!.caseId },
      });
      const [named] = await tx
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, org));
      let submitter: string;
      if (caller.type === "person") {
        const [person] = await tx
          .select({ name: user.name, email: user.email })
          .from(user)
          .where(eq(user.id, caller.userId));
        submitter = `${person?.name ?? "Unknown"} <${person?.email ?? "no email"}> (${caller.userId})`;
      } else {
        const [key] = await tx
          .select({ name: apikey.name })
          .from(apikey)
          .where(eq(apikey.id, caller.keyId));
        submitter = `API key ${key?.name ?? "without a name"} (${caller.keyId})`;
      }
      return { row: row!, orgName: named?.name ?? org, submitter };
    });
    const { row } = created;
    await trackEvent(
      c.env,
      "feedback_submitted",
      org,
      caller.type === "person" ? caller.userId : null,
      { category: row.category },
    );
    if (runMode(c.env).kind === "cloud" && c.env.FEEDBACK_EMAIL_TO)
      try {
        await c.env.EMAIL.send({
          from: c.env.EMAIL_FROM,
          to: c.env.FEEDBACK_EMAIL_TO,
          ...feedbackEmail(emailBrand(c.env), {
            feedbackId: row.id,
            orgName: created.orgName,
            orgId: org,
            category: row.category,
            agentId: row.agentId,
            caseId: row.caseId,
            client: row.client,
            submitter: created.submitter,
            message: row.message,
          }),
        });
      } catch (failure) {
        console.error(
          JSON.stringify({
            event: "feedback.email.failed",
            feedbackId: row.id,
            error: String(failure),
          }),
        );
      }
    return c.json({ id: row.id, createdAt: row.createdAt.toISOString() }, 201);
  },
);
