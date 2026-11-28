import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { SandboxesOverview } from "../../../features/developers/sandboxes-overview";

const loadDocsUrl = createServerFn({ method: "GET" }).handler(async () => {
  const { docsUrl } = await import("../../../server/run-mode.server");
  return docsUrl();
});

export const Route = createFileRoute("/settings/organization/sandboxes")({
  loader: () => loadDocsUrl(),
  component: OrganizationSandboxes,
});

function OrganizationSandboxes() {
  const docsUrl = Route.useLoaderData();
  return <SandboxesOverview docsUrl={docsUrl} />;
}
