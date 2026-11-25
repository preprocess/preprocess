// Notification email for tags, waits and assignments (design doc 06). The
// transaction that writes a mention, a wait on a new group or an assignment
// writes an outbox row; the EMAILS consumer resolves recipients at send time,
// skips people who turned email off, and sends one email per person. Keys
// already sent are kept in KV for a day, so a redelivery sends nothing twice.
// No email names another person.

import { orgId, withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { agents, groupMembers, groups } from "@preprocess/db/schema/access";
import { user } from "@preprocess/db/schema/auth";
import { caseMentions, cases } from "@preprocess/db/schema/cases";
import { and, eq, isNull } from "drizzle-orm";

import type { Env } from "./env.ts";
import type { OutboxMessage } from "./outbox.ts";
import { readOutbox, writeOutbox } from "./outbox.ts";

export type Notice =
  | { type: "mention"; mentionId: string }
  | {
      type: "waiting";
      caseId: string;
      groupId: string;
      since: string;
      reason: string | null;
    }
  | { type: "assigned"; caseId: string; userId: string; assignedAt: string };

// Inside the transaction that decides the notice.
export const notifyLater = async (
  tx: Tx,
  organizationId: string,
  notice: Notice,
) => ({
  id: await writeOutbox(tx, organizationId, "email", notice),
  kind: "email" as const,
});

export const caseRoomUrl = (env: Env, agentId: string, caseId: string) =>
  new URL(`/cases/${agentId}/${caseId}`, env.APP_URL).href;

type Email = { key: string; userIds: string[]; subject: string; text: string };

const caseRef = async (tx: Tx, caseId: string) => {
  const [row] = await tx
    .select({
      agentId: cases.agentId,
      title: cases.title,
      agent: agents.slug,
    })
    .from(cases)
    .innerJoin(agents, eq(agents.id, cases.agentId))
    .where(eq(cases.id, caseId));
  return row ?? null;
};

const groupOf = async (tx: Tx, groupId: string) => {
  const [group] = await tx
    .select({ name: groups.name })
    .from(groups)
    .where(eq(groups.id, groupId));
  return group ?? null;
};

// The group's members now, so membership changes need no rewriting.
const membersOf = async (tx: Tx, groupId: string) =>
  (
    await tx
      .select({ id: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
  ).map((m) => m.id);

const compose = async (
  env: Env,
  tx: Tx,
  notice: Notice,
): Promise<Email | null> => {
  if (notice.type === "mention") {
    const [mention] = await tx
      .select()
      .from(caseMentions)
      .where(eq(caseMentions.id, notice.mentionId));
    if (!mention) return null;
    const [ref, group] = await Promise.all([
      caseRef(tx, mention.caseId),
      groupOf(tx, mention.groupId),
    ]);
    if (!ref || !group) return null;
    const title = ref.title ?? "a case";
    return {
      key: `mention:${mention.id}`,
      // A person is not emailed about their own reference.
      userIds: (await membersOf(tx, mention.groupId)).filter(
        (id) => mention.by !== `person:${id}`,
      ),
      subject: `${group.name} was tagged on ${title} (${ref.agent})`,
      text: [
        `${mention.by === "agent" ? `The ${ref.agent} agent` : "Someone"} tagged ${group.name} on ${title}:`,
        "",
        mention.message,
        "",
        `Open the case: ${caseRoomUrl(env, ref.agentId, mention.caseId)}`,
      ].join("\n"),
    };
  }
  const ref = await caseRef(tx, notice.caseId);
  if (!ref) return null;
  const title = ref.title ?? "A case";
  const link = `Open the case: ${caseRoomUrl(env, ref.agentId, notice.caseId)}`;
  if (notice.type === "assigned")
    return {
      key: `assigned:${notice.caseId}:${notice.assignedAt}`,
      userIds: [notice.userId],
      subject: `${title} (${ref.agent}) was assigned to you`,
      text: [
        `${title} on the ${ref.agent} agent was assigned to you.`,
        "",
        link,
      ].join("\n"),
    };
  const group = await groupOf(tx, notice.groupId);
  if (!group) return null;
  return {
    key: `waiting:${notice.caseId}:${notice.since}`,
    userIds: await membersOf(tx, notice.groupId),
    subject: `${title} (${ref.agent}) is waiting on ${group.name}`,
    text: [
      `${title} on the ${ref.agent} agent is waiting on ${group.name}.`,
      ...(notice.reason ? ["", `Reason: ${notice.reason}`] : []),
      "",
      link,
    ].join("\n"),
  };
};

// The EMAILS consumer. Throws to have the queue retry.
export const sendNotice = async (env: Env, message: OutboxMessage) => {
  const row = await readOutbox(env, message);
  if (!row) return;
  const { email, recipients } = await withOrg(
    env,
    orgId(message.organizationId),
    async (tx) => {
      const email = await compose(env, tx, row.payload as Notice);
      if (!email) return { email: null, recipients: [] };
      const recipients: { id: string; address: string }[] = [];
      for (const id of new Set(email.userIds)) {
        const [person] = await tx
          .select({ address: user.email })
          .from(user)
          .where(
            and(
              eq(user.id, id),
              eq(user.emailNotifications, true),
              isNull(user.deactivatedAt),
            ),
          );
        if (person) recipients.push({ id, address: person.address });
      }
      return { email, recipients };
    },
  );
  if (!email) return;
  for (const recipient of recipients) {
    const sentKey = `${email.key}:${recipient.id}`;
    if (await env.EMAILS_SENT.get(sentKey)) continue;
    await env.EMAIL.send({
      from: env.EMAIL_FROM,
      to: recipient.address,
      subject: email.subject,
      text: email.text,
    });
    await env.EMAILS_SENT.put(sentKey, "1", { expirationTtl: 86_400 });
  }
};
