import { Link } from "@tanstack/react-router";
import { Button } from "@preprocess/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@preprocess/ui/components/empty";
import type { ReactNode } from "react";

import { CouldntLoadArt, GoneArt } from "./empty-art";

function RouteState({
  action,
  art,
  description,
  title,
}: Readonly<{
  action: ReactNode;
  art: ReactNode;
  description: string;
  title: string;
}>) {
  return (
    <Empty className="h-full min-h-0 border-0">
      <EmptyHeader>
        <EmptyMedia variant="graphic">{art}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  );
}

export function PageNotFound() {
  return (
    <RouteState
      action={
        <Button asChild size="sm" variant="secondary">
          <Link to="/inbox">Go to Inbox</Link>
        </Button>
      }
      art={<GoneArt />}
      description="The page you're looking for doesn't exist or may have moved."
      title="Page not found"
    />
  );
}

export function AgentNotFound() {
  return (
    <RouteState
      action={
        <Button asChild size="compact" variant="ghost">
          <Link to="/agents">Back to agents</Link>
        </Button>
      }
      art={<GoneArt />}
      description="This agent was deleted or doesn't exist."
      title="Agent not found"
    />
  );
}

export function CaseLinkNotValid() {
  return (
    <RouteState
      action={
        <Button asChild size="compact" variant="ghost">
          <Link to="/cases">Back to cases</Link>
        </Button>
      }
      art={<GoneArt />}
      description="This case link isn't valid."
      title="Case not found"
    />
  );
}

export function GroupNotFound() {
  return (
    <RouteState
      action={
        <Button asChild size="compact" variant="ghost">
          <Link to="/settings/organization/groups">Back to groups</Link>
        </Button>
      }
      art={<GoneArt />}
      description="This group was deleted or doesn't exist."
      title="Group not found"
    />
  );
}

export function RouteError() {
  return (
    <RouteState
      action={
        <Button
          onClick={() => window.location.reload()}
          size="sm"
          variant="secondary"
        >
          Reload page
        </Button>
      }
      art={<CouldntLoadArt />}
      description="We couldn't load this page. Try reloading, or come back in a moment."
      title="Something went wrong"
    />
  );
}
