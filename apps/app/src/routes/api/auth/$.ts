import { createFileRoute } from "@tanstack/react-router";

import { forwardToApi } from "../../../server/api.server";

const forward = ({ request }: { request: Request }) => forwardToApi(request);

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: forward,
      POST: forward,
      PUT: forward,
      PATCH: forward,
      DELETE: forward,
    },
  },
});
