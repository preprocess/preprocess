import { createFileRoute, redirect } from "@tanstack/react-router";

import {
  parseAgentCaseRef,
  stringifyAgentCaseRef,
} from "../../features/agent-cases/agent-case-ref";

/** The case room moved under its agent's Cases section. */
export const Route = createFileRoute("/cases/$agentId/$caseId")({
  params: {
    parse: (raw) => parseAgentCaseRef(raw),
    stringify: (ref) => stringifyAgentCaseRef(ref),
  },
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/agents/$agentId/cases/$caseId",
      params,
      search: true,
      replace: true,
    });
  },
});
