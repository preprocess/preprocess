import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";

import { validateOrganizationName } from "../../server/organization-name";
import {
  createWorkOsOrganization,
  listWorkOsOrganizations,
} from "../organizations/user-organizations";

export const createOrganization = createServerFn({ method: "POST" })
  .validator((input: { name: string }) => {
    const result = validateOrganizationName(input.name);
    if (!result.ok) {
      throw new Error(result.error);
    }
    return { name: result.name };
  })
  .handler(async ({ data }) => {
    const auth = await getAuth();
    if (!auth.user) {
      throw new Error("Sign in to create an organization.");
    }

    if (auth.organizationId) {
      return { organizationId: auth.organizationId };
    }

    // A user-only Widgets token works before an organization is selected.
    const organizations = await listWorkOsOrganizations(auth.user.id);
    const existing = organizations[0];
    if (existing) {
      return { organizationId: existing.id };
    }

    return createWorkOsOrganization(auth.user.id, data.name);
  });
