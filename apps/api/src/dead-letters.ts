import { capturePostHog } from "@preprocess/logs";

import type { Env } from "./env.ts";

export const DEAD_LETTERS_EVENT = "queue_dead_letters";

const queues = {
  jobs: "JOBS_DLQ",
  cases: "CASES_DLQ",
  webhooks: "WEBHOOKS_DLQ",
  emails: "EMAILS_DLQ",
  logs: "LOGS_DLQ",
} as const;

// Every minute: the dead-letter queues that hold messages, as one
// queue_dead_letters event each in PostHog (where configured) and a warning
// in the Worker's logs. An empty queue sends nothing, so any event at all
// means a consumer gave up on a message.
export const reportDeadLetters = async (env: Env) => {
  const held = [];
  for (const [queue, binding] of Object.entries(queues)) {
    const dlq = env[binding];
    if (!dlq) continue;
    const { backlogCount, oldestMessageTimestamp } = await dlq.metrics();
    if (backlogCount > 0)
      held.push({
        queue,
        depth: backlogCount,
        oldestMessageAt: oldestMessageTimestamp
          ? new Date(oldestMessageTimestamp).toISOString()
          : null,
      });
  }
  if (!held.length) return held;
  console.warn(JSON.stringify({ event: "queue.dead-letters", held }));
  await capturePostHog(env, "api", DEAD_LETTERS_EVENT, held);
  return held;
};
