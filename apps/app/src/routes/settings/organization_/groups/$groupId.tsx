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
  GROUP_TABS,
  GroupDetailView,
  PAGE_BACK,
  type GroupTab,
} from "../../../../features/groups/groups-panel";

function isGroupTab(value: unknown): value is GroupTab {
  return GROUP_TABS.some((tab) => tab.id === value);
}

// A group stands on its own page, outside Organization settings' tabs, with
// tabs of its own.
export const Route = createFileRoute("/settings/organization_/groups/$groupId")(
  {
    validateSearch: (search): { tab?: GroupTab } =>
      isGroupTab(search.tab) && search.tab !== "members"
        ? { tab: search.tab }
        : {},
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
  const { tab = "members" } = Route.useSearch();
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
      onTabChange={(next) =>
        void navigate({
          to: "/settings/organization/groups/$groupId",
          params: { groupId: group.id },
          search: next === "members" ? {} : { tab: next },
          replace: true,
        })
      }
      tab={tab}
    />
  );
}

function GroupNotFound() {
  return <p className="p-6 text-body">This group doesn't exist.</p>;
}
