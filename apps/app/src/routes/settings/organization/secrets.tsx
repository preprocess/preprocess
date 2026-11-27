import { createFileRoute } from "@tanstack/react-router";

import { SecretsSection } from "../../../features/developers/secret-list";

export const Route = createFileRoute("/settings/organization/secrets")({
  component: SecretsSection,
});
