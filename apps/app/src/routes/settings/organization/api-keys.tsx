import { createFileRoute } from "@tanstack/react-router";

import { KeysAndWebhooks } from "../../../features/developers/keys-and-webhooks";

export const Route = createFileRoute("/settings/organization/api-keys")({
  component: KeysAndWebhooks,
});
