import { createFileRoute, notFound } from "@tanstack/react-router";

import { loadLicenseRole } from "../../../features/settings/license-api";
import { LicensePanel } from "../../../features/settings/license-panel";

export const Route = createFileRoute("/settings/organization/license")({
  loader: async () => {
    const role = await loadLicenseRole();
    if (!role) throw notFound();
    return role;
  },
  component: OrganizationLicense,
});

function OrganizationLicense() {
  return <LicensePanel role={Route.useLoaderData()} />;
}
