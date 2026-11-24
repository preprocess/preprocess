"use client";

// The agent page's section sidebar (spec 14a): the agent's name and
// production deployment on top, its sections grouped as Operate, Ship and
// Manage, the current one a filled row, and the sections of a long page as
// anchors under it. On a narrow panel the sidebar gives way to a switcher in
// the breadcrumb that opens the same grouped list.

import { BreadcrumbItem } from "@preprocess/ui/components/breadcrumb";
import {
  DropdownContent,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from "@preprocess/ui/components/dropdown";
import { MenuItem } from "@preprocess/ui/components/menu-item";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@preprocess/ui/components/sidebar-menu";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  Brain,
  ChartLine,
  ChevronDown,
  Code,
  Gauge,
  Home,
  OrbitSparkle,
  Rocket,
  Settings,
  SquareLibrary,
  Users,
} from "@preprocess/ui/lib/icons";
import type { IconComponent } from "@preprocess/ui/lib/icon-context";
import { ShapeProvider } from "@preprocess/ui/lib/shape-context";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";

import { shortDeploymentId } from "./agent-store";
import type { OrgAgentDetail } from "./list-org-agents";

type SectionTo =
  | "/agents/$agentId"
  | "/agents/$agentId/observability"
  | "/agents/$agentId/evaluations"
  | "/agents/$agentId/memories"
  | "/agents/$agentId/training"
  | "/agents/$agentId/configuration"
  | "/agents/$agentId/deployments"
  | "/agents/$agentId/access"
  | "/agents/$agentId/settings";

type Section = {
  id: string;
  label: string;
  icon: IconComponent;
  to: SectionTo;
  group: "" | "Operate" | "Ship" | "Manage";
};

export const AGENT_SECTIONS = [
  { id: "", label: "Overview", icon: Home, to: "/agents/$agentId", group: "" },
  {
    id: "observability",
    label: "Observability",
    icon: Gauge,
    to: "/agents/$agentId/observability",
    group: "Operate",
  },
  {
    id: "evaluations",
    label: "Evaluations",
    icon: ChartLine,
    to: "/agents/$agentId/evaluations",
    group: "Operate",
  },
  {
    id: "memories",
    label: "Memories",
    icon: Brain,
    to: "/agents/$agentId/memories",
    group: "Operate",
  },
  {
    id: "training",
    label: "Training",
    icon: SquareLibrary,
    to: "/agents/$agentId/training",
    group: "Operate",
  },
  {
    id: "configuration",
    label: "Configuration",
    icon: Code,
    to: "/agents/$agentId/configuration",
    group: "Ship",
  },
  {
    id: "deployments",
    label: "Deployments",
    icon: Rocket,
    to: "/agents/$agentId/deployments",
    group: "Ship",
  },
  {
    id: "access",
    label: "Access",
    icon: Users,
    to: "/agents/$agentId/access",
    group: "Manage",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    to: "/agents/$agentId/settings",
    group: "Manage",
  },
] as const satisfies readonly Section[];

export type AgentSection = (typeof AGENT_SECTIONS)[number]["id"];

/** A jump link under the current section, to an element id on its page. */
export type SectionAnchor = { id: string; label: string };

export const sectionOf = (id: AgentSection) =>
  AGENT_SECTIONS.find((s) => s.id === id)!;

function grouped() {
  const groups: { label: string; sections: Section[] }[] = [];
  for (const section of AGENT_SECTIONS) {
    const last = groups.at(-1);
    if (last && last.label === section.group) last.sections.push(section);
    else groups.push({ label: section.group, sections: [section] });
  }
  return groups;
}

export function AgentSectionNav({
  agent,
  section,
  anchors,
}: {
  agent: OrgAgentDetail;
  section: AgentSection;
  anchors?: readonly SectionAnchor[];
}) {
  const hash = useRouterState({ select: (state) => state.location.hash });
  const params = { agentId: agent.id };
  return (
    <ShapeProvider defaultShape="rounded">
      <nav
        aria-label="Agent sections"
        className="hidden w-[220px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/60 px-2 py-3 md:flex"
      >
        <div className="flex items-center gap-2.5 px-2 pt-1.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-active text-foreground">
            <OrbitSparkle size={16} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span
              className="truncate text-body text-foreground"
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              {agent.name}
            </span>
            <span className="truncate text-caption text-muted-foreground">
              {agent.deploymentId
                ? `Production · ${shortDeploymentId(agent.deploymentId)}`
                : "Not deployed"}
            </span>
          </div>
        </div>
        {grouped().map((group) => (
          <div className="flex flex-col gap-1" key={group.label || "top"}>
            {group.label ? (
              <h2 className="px-2 pt-1 text-caption text-muted-foreground">
                {group.label}
              </h2>
            ) : null}
            <SidebarMenu
              aria-label={group.label || "Overview"}
              className="gap-1"
            >
              {group.sections.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    icon={item.icon}
                    isActive={item.id === section && !(anchors?.length && hash)}
                    render={<Link params={params} to={item.to} />}
                  >
                    {item.label}
                  </SidebarMenuButton>
                  {item.id === section && anchors?.length ? (
                    <SidebarMenuSub>
                      {anchors.map((anchor) => (
                        <SidebarMenuSubItem key={anchor.id}>
                          <SidebarMenuSubButton
                            isActive={hash === anchor.id}
                            render={
                              <Link
                                hash={anchor.id}
                                params={params}
                                to={item.to}
                              />
                            }
                          >
                            {anchor.label}
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </div>
        ))}
      </nav>
    </ShapeProvider>
  );
}

/** The breadcrumb's section item: a plain label on wide panels, a menu of
 *  every section on narrow ones. */
export function AgentSectionCrumb({
  agentId,
  section,
  linked,
}: {
  agentId: string;
  section: AgentSection;
  /** A detail page links back to its section. */
  linked: boolean;
}) {
  const navigate = useNavigate();
  const current = sectionOf(section);
  const params = { agentId };
  let index = 0;
  return (
    <BreadcrumbItem className="min-w-0">
      <span className="hidden min-w-0 md:inline">
        {linked ? (
          <Link
            className="truncate text-muted-foreground hover:text-foreground"
            params={params}
            to={current.to}
          >
            {current.label}
          </Link>
        ) : (
          <span aria-current="page" className="truncate text-foreground">
            {current.label}
          </span>
        )}
      </span>
      <DropdownMenu>
        <DropdownTrigger
          render={
            <button
              aria-label={`Section: ${current.label}`}
              className="flex min-w-0 items-center gap-1 text-foreground md:hidden"
              type="button"
            />
          }
        >
          <span className="truncate">{current.label}</span>
          <ChevronDown className="shrink-0 text-muted-foreground" size={14} />
        </DropdownTrigger>
        <DropdownContent align="start" sideOffset={6}>
          {grouped().map((group, g) => (
            <Fragment key={group.label || "top"}>
              {g > 0 ? <DropdownSeparator /> : null}
              {group.label ? (
                <DropdownLabel>{group.label}</DropdownLabel>
              ) : null}
              {group.sections.map((item) => (
                <MenuItem
                  checked={item.id === section}
                  icon={item.icon}
                  index={index++}
                  key={item.id}
                  label={item.label}
                  onSelect={() => void navigate({ to: item.to, params })}
                />
              ))}
            </Fragment>
          ))}
        </DropdownContent>
      </DropdownMenu>
    </BreadcrumbItem>
  );
}
