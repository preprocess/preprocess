import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";

// SSO, Directory Sync, domain verification, and log streams get their Admin
// Portal links from the Client API (CreateAdminPortalLink). Bring Your Own
// Key is not an AdminPortalLinkIntent there, so it is minted server-side.
export const generateAdminPortalLink = createServerFn({ method: "POST" })
  .validator((input: { intent: "bring_your_own_key" }) => {
    if (input.intent !== "bring_your_own_key") {
      throw new Error("Unsupported Admin Portal intent.");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const auth = await getAuth();
    if (!auth.user || !auth.organizationId) {
      throw new Error("Sign in to an organization to continue.");
    }

    // Keep WorkOS Node client off the client graph.
    const { getWorkOS } = await import("../../server/workos.server");
    const { link } = await getWorkOS().adminPortal.generateLink({
      intent: data.intent,
      organization: auth.organizationId,
    });

    return { link };
  });
