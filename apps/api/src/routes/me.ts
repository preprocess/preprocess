// The signed-in person's own state, across every organization they belong to.
// Today that is the announcements they dismissed from the app's sidebar notice
// stack. A dismissal is per person, so it lives outside any organization and
// is read and written through withoutOrg, only ever for the session's user.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { withoutOrg, withoutOrgRead } from "@preprocess/db/client";
import { noticeDismissals } from "@preprocess/db/schema/notices";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { readSession } from "../auth.ts";
import type { Env } from "../env.ts";

type MeVariables = { userId: string };

const signedIn = createMiddleware<{
  Bindings: Env;
  Variables: MeVariables;
}>(async (c, next) => {
  const session = await readSession(c.env, c.req.raw);
  if (!session) throw new HTTPException(401, { message: "Sign in first." });
  c.set("userId", session.user.id);
  await next();
});

const NoticeParam = z.object({
  notice: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .openapi({ description: "The announcement's id" }),
});

const Dismissed = z
  .object({
    ids: z.array(z.string()).openapi({
      description: "Ids of the announcements the person dismissed",
    }),
  })
  .openapi("DismissedNotices");

export const meRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: MeVariables;
}>();

meRoutes.use(signedIn);

meRoutes
  .openapi(
    createRoute({
      method: "get",
      path: "/notices/dismissed",
      tags: ["Me"],
      summary: "Announcements the signed-in person dismissed",
      responses: {
        200: {
          content: { "application/json": { schema: Dismissed } },
          description: "The dismissed announcements",
        },
        401: { description: "Not signed in" },
      },
    }),
    async (c) => {
      const rows = await withoutOrgRead(c.env, "notice dismissals", (tx) =>
        tx
          .select({ id: noticeDismissals.noticeId })
          .from(noticeDismissals)
          .where(eq(noticeDismissals.userId, c.var.userId)),
      );
      return c.json({ ids: rows.map((row) => row.id) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/notices/dismissed/{notice}",
      tags: ["Me"],
      summary: "Dismiss an announcement for the signed-in person",
      request: { params: NoticeParam },
      responses: {
        204: { description: "Dismissed; dismissing again changes nothing" },
        401: { description: "Not signed in" },
      },
    }),
    async (c) => {
      const { notice } = c.req.valid("param");
      await withoutOrg(c.env, "notice dismissals", (tx) =>
        tx
          .insert(noticeDismissals)
          .values({ userId: c.var.userId, noticeId: notice })
          .onConflictDoNothing(),
      );
      return c.body(null, 204);
    },
  );
