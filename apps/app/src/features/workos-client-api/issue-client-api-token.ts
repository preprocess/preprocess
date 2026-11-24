import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";

export const issueClientApiToken = createServerFn({ method: "POST" }).handler(
  async () => {
    const auth = await getAuth();
    if (!auth.user || !auth.organizationId) {
      throw new Error("Sign in to an organization to continue.");
    }

    const { mintWidgetsApiToken } =
      await import("../../server/widgets-api.server");
    const token = await mintWidgetsApiToken(auth.user.id, auth.organizationId);

    return {
      token,
      organizationId: auth.organizationId,
    };
  },
);
