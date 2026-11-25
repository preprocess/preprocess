import { createFileRoute, useRouter } from "@tanstack/react-router";

import {
  parseAgentCaseRef,
  stringifyAgentCaseRef,
} from "../../features/agent-cases/agent-case-ref";
import { AgentCaseRoom } from "../../features/agent-cases/agent-case-room";
import { agentSummaries } from "../../features/agents/agent-store";
import { rememberedCasesSearch } from "../../features/agent-cases/case-inbox-search";
import {
  caseWorkActions,
  getCaseRoom,
} from "../../features/agent-cases/case-room-data";
import { FLUE_LAB_INPUT_SAMPLES } from "../../features/agent-cases/flue-lab-input-samples";
import {
  getOrgCase,
  getOrgCaseNeighbors,
  orgCaseStatusSetter,
} from "../../features/agent-cases/list-org-cases";

export const Route = createFileRoute("/cases/$agentId/$caseId")({
  staticData: { ownsHeader: true },
  params: {
    parse: (raw) => parseAgentCaseRef(raw),
    stringify: (ref) => stringifyAgentCaseRef(ref),
  },
  loader: async ({ params }) => {
    const [item, neighbors, room] = await Promise.all([
      getOrgCase(params.agentId, params.caseId),
      // Prev/next step through the list as it was last shown.
      getOrgCaseNeighbors(
        rememberedCasesSearch(),
        params.agentId,
        params.caseId,
      ),
      getCaseRoom(params.agentId, params.caseId),
    ]);
    return {
      item,
      neighbors,
      room,
      agent: agentSummaries()[params.agentId] ?? null,
    };
  },
  component: AgentCasePage,
  errorComponent: AgentCaseParamsError,
});

function AgentCasePage() {
  const caseRef = Route.useParams();
  const { item, neighbors, agent, room } = Route.useLoaderData();
  const router = useRouter();
  const { agentId, caseId } = caseRef;
  const refresh = async <T,>(result: Promise<T>) => {
    const value = await result;
    await router.invalidate();
    return value;
  };
  const setStatus = orgCaseStatusSetter();

  return (
    <AgentCaseRoom
      agent={agent}
      caseItem={item}
      caseRef={caseRef}
      // Seeded input so the viewers are exercisable. Builds outside dev serve none.
      inputSamples={import.meta.env.DEV ? FLUE_LAB_INPUT_SAMPLES : undefined}
      neighbors={neighbors}
      work={{ room, actions: caseWorkActions(agentId, caseId, refresh) }}
      onStatusChange={
        setStatus
          ? (status) => refresh(setStatus(agentId, caseId, status))
          : undefined
      }
    />
  );
}

function AgentCaseParamsError() {
  return <p className="p-6 text-body">This case link is not valid.</p>;
}
