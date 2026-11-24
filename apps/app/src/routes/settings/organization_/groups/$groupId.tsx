import {
  createFileRoute,
  notFound,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import {
  addGroupMembers,
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
    loader: ({ params }) => {
      const group = groupDetail(params.groupId);
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
  const refresh = () => router.invalidate();

  return (
    <GroupDetailView
      group={group}
      onAccessChange={async (agentId, level) => {
        await setGroupAgentAccess(group.name, agentId, level);
        await refresh();
      }}
      onAddMember={async (personId) => {
        await addGroupMembers(group.id, [personId]);
        await refresh();
      }}
      onDelete={async () => {
        await deleteGroup(group.id);
        await navigate({
          to: "/settings/organization/groups",
          viewTransition: PAGE_BACK,
        });
      }}
      onRemoveMember={async (personId) => {
        await removeGroupMember(group.id, personId);
        await refresh();
      }}
    />
  );
}

function GroupNotFound() {
  return <p className="p-6 text-body">This group doesn't exist.</p>;
}
