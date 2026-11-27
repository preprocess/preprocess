import { createFileRoute } from "@tanstack/react-router";

import { GitHubSettings } from "../../../features/developers/github-section";

export const Route = createFileRoute("/settings/organization/github")({
  component: GitHubSettings,
});
