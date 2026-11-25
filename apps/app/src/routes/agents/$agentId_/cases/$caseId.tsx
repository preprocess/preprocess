import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";

import {
  parseAgentCaseRef,
  stringifyAgentCaseRef,
} from "../../../../features/agent-cases/agent-case-ref";
import { AgentCaseRoom } from "../../../../features/agent-cases/agent-case-room";
import { rememberedCasesSearch } from "../../../../features/agent-cases/case-inbox-search";
import {
  caseWorkActions,
  getCaseRoom,
} from "../../../../features/agent-cases/case-room-data";
import { FLUE_LAB_INPUT_SAMPLES } from "../../../../features/agent-cases/flue-lab-input-samples";
import { currentScenario } from "../../../../scenarios/current-scenario";
import {
  getCaseAgent,
  getOrgCase,
  getOrgCaseNeighbors,
  orgCaseStatusSetter,
} from "../../../../features/agent-cases/list-org-cases";

// Not nested under /agents/$agentId, like the agent's case list: seeded
// cases name agents the API doesn't have.
export const Route = createFileRoute("/agents/$agentId_/cases/$caseId")({
  staticData: { ownsHeader: true },
  params: {
    parse: (raw) => parseAgentCaseRef(raw),
    stringify: (ref) => stringifyAgentCaseRef(ref),
  },
  loader: async ({ params }) => {
    const [agent, item, neighbors, room] = await Promise.all([
      getCaseAgent(params.agentId),
      getOrgCase(params.agentId, params.caseId),
      // Prev/next step through the list as it was last shown.
      getOrgCaseNeighbors(
        rememberedCasesSearch(),
        params.agentId,
        params.caseId,
      ),
      getCaseRoom(params.agentId, params.caseId),
    ]);
    if (!agent) throw notFound();
    return { agent, item, neighbors, room };
  },
  component: AgentCasePage,
  errorComponent: AgentCaseParamsError,
  notFoundComponent: () => (
    <p className="p-6 text-body">This agent doesn't exist.</p>
  ),
});

function AgentCasePage() {
  const caseRef = Route.useParams();
  const { agent, item, neighbors, room } = Route.useLoaderData();
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
      // Seeded input so the viewers are exercisable, for seeded cases only.
      // Builds outside dev serve none.
      inputSamples={
        import.meta.env.DEV && currentScenario()["case-work"] !== "live"
          ? FLUE_LAB_INPUT_SAMPLES
          : undefined
      }
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
