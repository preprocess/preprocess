import { createFileRoute, useNavigate } from "@tanstack/react-router";

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

  return (
    <GroupsList
      groups={Route.useLoaderData()}
      onCreate={async (name) => {
        const group = await createGroup(name);
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
