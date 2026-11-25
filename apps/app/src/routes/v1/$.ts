import { createFileRoute } from "@tanstack/react-router";

import { forwardToApi } from "../../server/api.server";

const forward = ({ request }: { request: Request }) => forwardToApi(request);

export const Route = createFileRoute("/v1/$")({
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
