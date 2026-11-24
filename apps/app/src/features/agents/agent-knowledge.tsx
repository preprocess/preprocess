import { SettingsCard, SettingsEmpty, SettingsSection } from "../settings/kit";
import type { AgentMemory } from "./agent-memories";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

function MemoryRow({ memory }: Readonly<{ memory: AgentMemory }>) {
  return (
    <div className="flex min-h-12 items-center gap-3 px-5 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-foreground">{memory.text}</span>
        <span className="truncate text-caption text-muted-foreground">
          {memory.source === "learned"
            ? `Learned on ${memory.from}`
            : `Added by ${memory.from}`}
        </span>
      </div>
      <time
        className="w-12 shrink-0 text-right text-caption text-muted-foreground tabular-nums"
        dateTime={memory.createdAt}
      >
        {dateFormat.format(new Date(memory.createdAt))}
      </time>
    </div>
  );
}

/** Memories as rows in one card, or an empty state. */
export function MemoryList({
  memories,
}: Readonly<{ memories: readonly AgentMemory[] }>) {
  return memories.length > 0 ? (
    <SettingsCard className="flex flex-col divide-y divide-border/60">
      {memories.map((memory) => (
        <MemoryRow key={memory.id} memory={memory} />
      ))}
    </SettingsCard>
  ) : (
    <SettingsEmpty
      description="Memories the agent learns, or that you add, will show up here."
      title="No memories yet"
    />
  );
}

/** Placeholder: how this agent's runs are going. */
export function AgentObservability() {
  return (
    <SettingsSection
      description="Runs, errors, latency, and cost for this agent's cases."
      title="Observability"
    >
      <SettingsEmpty
        description="Metrics and traces from this agent's runs will show up here."
        title="Nothing to show yet"
      />
    </SettingsSection>
  );
}

/** What the agent keeps between cases. */
export function AgentMemories({
  memories,
}: Readonly<{ memories: readonly AgentMemory[] }>) {
  return (
    <SettingsSection
      description="Facts and rules this agent keeps between cases, learned on a case or added by someone."
      title="Memories"
    >
      <MemoryList memories={memories} />
    </SettingsSection>
  );
}

/** Placeholder: the agent's evaluation suites. */
export function AgentEvaluations() {
  return (
    <SettingsSection
      description="Suites of graded cases scored against each deployment, so a release that makes things worse shows up."
      title="Evaluations"
    >
      <SettingsEmpty
        description="Evaluation suites and their scores will show up here."
        title="No evaluations yet"
      />
    </SettingsSection>
  );
}

/** Placeholder: what people say about the agent's work. */
export function AgentFeedback() {
  return (
    <SettingsSection
      description="Ratings and corrections people leave on this agent's work."
      title="Feedback"
    >
      <SettingsEmpty
        description="Feedback on this agent's cases will show up here."
        title="No feedback yet"
      />
    </SettingsSection>
  );
}
