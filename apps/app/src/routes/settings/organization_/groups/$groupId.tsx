import {
  createFileRoute,
  notFound,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import { GroupNotFound } from "../../../../components/route-states";
import { useOrganizationId } from "../../../../features/auth/auth-context";
import {
  addGroupMember,
  deleteGroup,
  groupDetail,
  removeGroupMember,
  setGroupAgentAccess,
} from "../../../../features/groups/group-store";
import {
  GroupDetailView,
  PAGE_BACK,
} from "../../../../features/groups/groups-panel";

export const Route = createFileRoute("/settings/organization_/groups/$groupId")(
  {
    loader: async ({ params }) => {
      const group = await groupDetail({ data: params.groupId });
      if (!group) throw notFound();
      return group;
    },
    component: OrganizationGroupPage,
    notFoundComponent: GroupNotFound,
  },
);

function OrganizationGroupPage() {
  const group = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const organizationId = useOrganizationId();
  const refresh = () => router.invalidate();

  return (
    <GroupDetailView
      group={group}
      onAccessChange={async (agentId, level) => {
        await setGroupAgentAccess(organizationId, group.id, agentId, level);
        await refresh();
      }}
      onAddMember={async (personId) => {
        await addGroupMember(organizationId, group.id, personId);
        await refresh();
      }}
      onDelete={async () => {
        await deleteGroup(organizationId, group.id);
        await navigate({
          to: "/settings/organization/groups",
          viewTransition: PAGE_BACK,
        });
      }}
      onRemoveMember={async (personId) => {
        await removeGroupMember(organizationId, group.id, personId);
        await refresh();
      }}
    />
  );
}
