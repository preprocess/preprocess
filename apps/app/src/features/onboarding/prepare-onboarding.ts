import { createServerFn } from "@tanstack/react-start";
import {
  getAuth,
  switchToOrganizationAction,
} from "@workos/authkit-tanstack-react-start";

import { listWorkOsOrganizations } from "../organizations/user-organizations";

export type PrepareOnboardingResult =
  | { status: "unauthenticated" }
  | { status: "ready" }
  | { status: "needs_org"; email: string };

export const prepareOnboarding = createServerFn({ method: "GET" }).handler(
  async (): Promise<PrepareOnboardingResult> => {
    const auth = await getAuth();
    if (!auth.user) {
      return { status: "unauthenticated" };
    }

    if (auth.organizationId) {
      return { status: "ready" };
    }

    // A user-only Widgets token works before an organization is selected.
    const organizations = await listWorkOsOrganizations(auth.user.id);
    const existing = organizations[0];
    if (existing) {
      // Action variant returns data — no redirect Response for the RPC client.
      await switchToOrganizationAction({
        data: { organizationId: existing.id },
      });
      return { status: "ready" };
    }

    return { status: "needs_org", email: auth.user.email };
  },
);
