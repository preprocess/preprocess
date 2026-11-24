import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { useOrganizationId } from "../../../../features/auth/auth-context";
import {
  createGroup,
  groupSummaries,
} from "../../../../features/groups/group-store";
import {
  GroupsList,
  PAGE_FORWARD,
} from "../../../../features/groups/groups-panel";

export const Route = createFileRoute("/settings/organization/groups/")({
  loader: () => groupSummaries(),
  component: OrganizationGroupsPage,
});

function OrganizationGroupsPage() {
  const navigate = useNavigate();
  const organizationId = useOrganizationId();

  return (
    <GroupsList
      groups={Route.useLoaderData()}
      onCreate={async (name) => {
        const group = await createGroup(organizationId, name);
        await navigate({
          to: "/settings/organization/groups/$groupId",
          params: { groupId: group.id },
          viewTransition: PAGE_FORWARD,
        });
        return group;
      }}
    />
  );
}
