// Notification email for tags, waits and assignments (design doc 06). The
// transaction that writes a mention, a wait on a new group or an assignment
// writes an outbox row; the EMAILS consumer resolves recipients at send time,
// skips people who turned email off, and sends one email per person. Keys
// already sent are kept in KV for a day, so a redelivery sends nothing twice.
// A person's tag names that person; nothing else names other people. A synced
// group the identity provider removed goes to the Developers, Owners and
// Admins (scim.ts).

import { orgId, withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { agents, groupMembers, groups } from "@preprocess/db/schema/access";
import { member, organization, user } from "@preprocess/db/schema/auth";
import { caseMentions, cases } from "@preprocess/db/schema/cases";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { agentsNamingGroup } from "./deploy.ts";
import {
  assignedEmail,
  groupRemovedEmail,
  taggedEmail,
  waitingEmail,
} from "./email-templates.ts";
import type { RenderedEmail } from "./email-templates.ts";
import { emailBrand, sendEmail } from "./email.ts";
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
  | { type: "assigned"; caseId: string; userId: string; assignedAt: string }
  | { type: "scim.group.removed"; groupId: string; removedAt: string };

export const DIRECTORY_SYNC_PATH = "/settings/organization/directory-sync";

// Who hears about a removed synced group: the Owners, the Admins and the
// Developers group's members.
export const removedGroupAudience = async (tx: Tx, organizationId: string) => {
  const admins = await tx
    .select({ id: member.userId })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        inArray(member.role, ["owner", "admin"]),
      ),
    );
  const developers = await tx
    .select({ id: groupMembers.userId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groups.organizationId, organizationId),
        eq(groups.isDevelopers, true),
      ),
    );
  return [...new Set([...admins, ...developers].map((p) => p.id))];
};

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

type Email = { key: string; userIds: string[]; email: RenderedEmail };

const caseRef = async (tx: Tx, caseId: string) => {
  const [row] = await tx
    .select({
      agentId: cases.agentId,
      title: cases.title,
      agent: agents.slug,
      orgName: organization.name,
    })
    .from(cases)
    .innerJoin(agents, eq(agents.id, cases.agentId))
    .innerJoin(organization, eq(organization.id, cases.organizationId))
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

const caseData = (
  env: Env,
  ref: NonNullable<Awaited<ReturnType<typeof caseRef>>>,
  caseId: string,
) => ({
  url: caseRoomUrl(env, ref.agentId, caseId),
  settingsUrl: new URL("/settings/account", env.APP_URL).href,
  orgName: ref.orgName,
  agent: ref.agent,
  caseTitle: ref.title,
});

// The display name of the person who tagged, or "Someone" without one.
const taggerName = async (tx: Tx, by: string) => {
  const id = by.startsWith("person:") ? by.slice("person:".length) : null;
  if (!id) return "Someone";
  const [person] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, id));
  return person?.name.trim() || "Someone";
};

const compose = async (
  env: Env,
  tx: Tx,
  notice: Notice,
): Promise<Email | null> => {
  const brand = emailBrand(env);
  if (notice.type === "scim.group.removed") {
    const [group] = await tx
      .select({
        name: groups.name,
        removedAt: groups.syncedRemovedAt,
        people: groups.syncedRemovedMembers,
        organizationId: groups.organizationId,
        orgName: organization.name,
      })
      .from(groups)
      .innerJoin(organization, eq(organization.id, groups.organizationId))
      .where(eq(groups.id, notice.groupId));
    // Deleted, or re-linked by the directory, since.
    if (!group?.removedAt || group.removedAt.toISOString() !== notice.removedAt)
      return null;
    return {
      key: `scim.group.removed:${notice.groupId}:${notice.removedAt}`,
      userIds: await removedGroupAudience(tx, group.organizationId),
      email: groupRemovedEmail(brand, {
        url: new URL(DIRECTORY_SYNC_PATH, env.APP_URL).href,
        orgName: group.orgName,
        groupName: group.name,
        at: group.removedAt,
        people: group.people ?? 0,
        agents: (await agentsNamingGroup(tx, notice.groupId)).length,
      }),
    };
  }
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
    return {
      key: `mention:${mention.id}`,
      // A person is not emailed about their own reference.
      userIds: (await membersOf(tx, mention.groupId)).filter(
        (id) => mention.by !== `person:${id}`,
      ),
      email: taggedEmail(brand, {
        ...caseData(env, ref, mention.caseId),
        tagger:
          mention.by === "agent"
            ? `The ${ref.agent} agent`
            : await taggerName(tx, mention.by),
        groupName: group.name,
        message: mention.message,
      }),
    };
  }
  const ref = await caseRef(tx, notice.caseId);
  if (!ref) return null;
  if (notice.type === "assigned")
    return {
      key: `assigned:${notice.caseId}:${notice.assignedAt}`,
      userIds: [notice.userId],
      email: assignedEmail(brand, caseData(env, ref, notice.caseId)),
    };
  const group = await groupOf(tx, notice.groupId);
  if (!group) return null;
  return {
    key: `waiting:${notice.caseId}:${notice.since}`,
    userIds: await membersOf(tx, notice.groupId),
    email: waitingEmail(brand, {
      ...caseData(env, ref, notice.caseId),
      groupName: group.name,
      reason: notice.reason,
    }),
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
    await sendEmail(env, recipient.address, email.email);
    await env.EMAILS_SENT.put(sentKey, "1", { expirationTtl: 86_400 });
  }
};
