import { Button } from "@preprocess/ui/components/button";
import { ChevronRight } from "@preprocess/ui/lib/icons";
import { Link } from "@tanstack/react-router";

import { FillsOnItsOwnArt, NotDeployedArt } from "../../components/empty-art";

import { parseAgentId, parseCaseId } from "../agent-cases/agent-case-ref";
import { orgApi } from "../auth/client";
import { useOrgJson } from "../evals/eval-api";
import {
  SettingsConfirmBody,
  SettingsDialog,
  SettingsEmpty,
  SettingsError,
  SettingsRow,
  SettingsRowSkeleton,
  SettingsRows,
  SettingsSection,
  formatRelative,
} from "../settings/kit";

// The agent's memory (spec 10): rules it proposed on a case that a person
// accepted, which every new case and rerun receives. Proposals are decided in
// the case's Review tab; here they are listed with a link to their case.

type Memory = {
  readonly id: string;
  readonly caseId: string;
  readonly text: string;
  readonly reason: string | null;
  readonly status: "proposed" | "accepted" | "dismissed";
  readonly proposedAt: string;
  readonly decidedAt: string | null;
};

type MemoryList = {
  readonly memories: readonly Memory[];
  readonly cap: number;
};

const countFormat = new Intl.NumberFormat();

export function AgentMemories({ agentSlug }: Readonly<{ agentSlug: string }>) {
  const base = `/agents/${encodeURIComponent(agentSlug)}/memories`;
  const accepted = useOrgJson<MemoryList>(base);
  const proposed = useOrgJson<MemoryList>(`${base}?status=proposed`);

  return (
    <>
      <SettingsSection
        description={
          accepted.state.kind === "ready"
            ? `Rules this agent proposed on a case and a person accepted. Every new case and rerun receives them, oldest first. ${countFormat.format(accepted.state.data.memories.length)} of ${countFormat.format(accepted.state.data.cap)} used.`
            : "Rules this agent proposed on a case and a person accepted. Every new case and rerun receives them, oldest first."
        }
        title="Memories"
      >
        {accepted.state.kind === "loading" ? (
          <SettingsRows>
            <SettingsRowSkeleton label="Rule" />
            <SettingsRowSkeleton label="Rule" />
          </SettingsRows>
        ) : accepted.state.kind === "missing" ? (
          <SettingsEmpty
            art={<NotDeployedArt />}
            description="Memories are proposed while a deployed agent works cases."
            title="Deploy this agent first"
          />
        ) : accepted.state.kind === "failed" ? (
          <SettingsError error={accepted.state.error} />
        ) : accepted.state.data.memories.length === 0 ? (
          <SettingsEmpty
            art={<FillsOnItsOwnArt />}
            description="Rules the agent proposes and your team accepts appear here and load into future cases."
            title="No memories yet"
          />
        ) : (
          <SettingsRows>
            {accepted.state.data.memories.map((memory) => (
              <SettingsRow
                description={`Accepted ${formatRelative(memory.decidedAt ?? memory.proposedAt)} · learned on ${memory.caseId}`}
                key={memory.id}
                label={memory.text}
              >
                <SettingsDialog
                  description="New cases and reruns stop receiving it. Cases already running keep it until their next run."
                  title="Delete this rule"
                  content={(close) => (
                    <SettingsConfirmBody
                      actionLabel="Delete"
                      onCancel={close}
                      onConfirm={async () => {
                        await orgApi(
                          accepted.organizationId,
                          `${base}/${memory.id}`,
                          { method: "DELETE" },
                        );
                        close();
                        accepted.reload();
                      }}
                      pendingLabel="Deleting…"
                      successLabel="Deleted"
                    />
                  )}
                >
                  <Button type="button" variant="secondary">
                    Delete
                  </Button>
                </SettingsDialog>
              </SettingsRow>
            ))}
          </SettingsRows>
        )}
      </SettingsSection>
      {proposed.state.kind === "ready" &&
      proposed.state.data.memories.length > 0 ? (
        <SettingsSection
          description="Rules the agent proposed that wait for a person. Accept or dismiss each in its case's Review tab."
          title={`Waiting for review (${countFormat.format(proposed.state.data.memories.length)})`}
        >
          <SettingsRows>
            {proposed.state.data.memories.map((memory) => (
              <Link
                key={memory.id}
                params={{
                  agentId: parseAgentId(agentSlug),
                  caseId: parseCaseId(memory.caseId),
                }}
                to="/agents/$agentId/cases/$caseId"
              >
                <SettingsRow
                  description={`Proposed ${formatRelative(memory.proposedAt)}${memory.reason ? ` · ${memory.reason}` : ""}`}
                  label={memory.text}
                >
                  <ChevronRight size={16} />
                </SettingsRow>
              </Link>
            ))}
          </SettingsRows>
        </SettingsSection>
      ) : null}
    </>
  );
}
