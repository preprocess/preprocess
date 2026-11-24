"use client";

// Port of the WorkOS UserSessions widget (@workos-inc/widgets).

import { Button } from "@preprocess/ui/components/button";
import { Monitor, RectangleHorizontal } from "@preprocess/ui/lib/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { useState } from "react";

import {
  useWorkOsQuery,
  useWorkOsSdk,
  workOsKey,
} from "../workos-client-api/sdk";
import { expectResultMember } from "../workos-client-api/vendor/client-graphql-result";
import type { SessionsQuery } from "../workos-client-api/vendor/generated";
import {
  SettingsConfirmDialog,
  SettingsError,
  SettingsIconTile,
  SettingsReveal,
  SettingsRow,
  SettingsRows,
  SettingsRowSkeleton,
  SettingsStatus,
  SkeletonButton,
  SkeletonTile,
} from "./kit";
import {
  deviceLabel,
  isMobileAgent,
  relativeTime,
  sessionLocation,
} from "./settings-format";

type ClientSession = SessionsQuery["sessions"][number];

function SessionRow({
  session,
  current,
  onSignOut,
}: {
  session: ClientSession;
  current: boolean;
  onSignOut: () => void;
}) {
  const location = sessionLocation({
    currentLocation: session.currentLocation ?? null,
    ipAddress: session.ipAddress ?? null,
  });
  const lastSeen = relativeTime(session.lastActivityAt ?? session.createdAt);
  return (
    <SettingsRow
      description={current ? location : `${location} · Last seen ${lastSeen}`}
      label={deviceLabel(session.userAgent)}
      leading={
        <SettingsIconTile
          icon={
            isMobileAgent(session.userAgent) ? RectangleHorizontal : Monitor
          }
        />
      }
    >
      {current ? (
        <SettingsStatus state="success">This device</SettingsStatus>
      ) : (
        <Button onClick={onSignOut} type="button" variant="secondary">
          Sign out
        </Button>
      )}
    </SettingsRow>
  );
}

function SessionsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsRows>
        <SettingsRowSkeleton
          action={88}
          description={140}
          label={150}
          leading={<SkeletonTile />}
        />
        <SettingsRowSkeleton
          action={72}
          description={180}
          label={130}
          leading={<SkeletonTile />}
        />
        <SettingsRowSkeleton
          action={72}
          description={160}
          label={140}
          leading={<SkeletonTile />}
        />
      </SettingsRows>
      <SettingsRows>
        <SettingsRow
          description="Remove access from all devices except this one"
          label="Sign out of all other devices"
        >
          <SkeletonButton width={76} />
        </SettingsRow>
      </SettingsRows>
    </div>
  );
}

export function SessionsPanel() {
  const { sessionId } = useAuth();
  const sdk = useWorkOsSdk();
  const queryClient = useQueryClient();
  const sessionsQuery = useWorkOsQuery({
    queryKey: workOsKey("Sessions"),
    queryFn: (client) => client.Sessions(),
  });
  const [picked, setPicked] = useState<ClientSession | null>(null);
  const [signOutAllOpen, setSignOutAllOpen] = useState(false);

  if (sessionsQuery.isError)
    return <SettingsError error={sessionsQuery.error} />;

  return (
    <SettingsReveal data={sessionsQuery.data} skeleton={<SessionsSkeleton />}>
      {(data) => {
        const sessions = data.sessions;
        const isCurrent = (session: ClientSession) =>
          sessionId ? session.id === sessionId : session.isCurrent;
        const current = sessions.find(isCurrent);
        const others = sessions.filter((session) => !isCurrent(session));

        const setSessions = (
          next: (list: ClientSession[]) => ClientSession[],
        ) => {
          queryClient.setQueryData<SessionsQuery>(
            workOsKey("Sessions"),
            (data) =>
              data ? { ...data, sessions: next(data.sessions) } : data,
          );
        };

        return (
          <div className="flex flex-col gap-6" data-testid="sessions-panel">
            <SettingsRows>
              {current ? (
                <SessionRow
                  current
                  onSignOut={() => undefined}
                  session={current}
                />
              ) : null}
              {others.map((session) => (
                <SessionRow
                  current={false}
                  key={session.id}
                  onSignOut={() => setPicked(session)}
                  session={session}
                />
              ))}
            </SettingsRows>

            {others.length > 0 ? (
              <SettingsRows>
                <SettingsRow
                  description="Remove access from all devices except this one"
                  label="Sign out of all other devices"
                >
                  <Button
                    onClick={() => setSignOutAllOpen(true)}
                    type="button"
                    variant="secondary"
                  >
                    Sign out
                  </Button>
                </SettingsRow>
              </SettingsRows>
            ) : null}

            <SettingsConfirmDialog
              confirmLabel="Sign out"
              description={
                picked
                  ? `You will be signed out of ${deviceLabel(picked.userAgent)}.`
                  : undefined
              }
              onConfirm={async () => {
                if (!picked) return;
                const data = await sdk.RevokeSession({
                  input: { sessionId: picked.id },
                });
                expectResultMember(data.revokeSession, "SessionRevoked");
                setSessions((list) =>
                  list.filter((item) => item.id !== picked.id),
                );
              }}
              onOpenChange={(open) => {
                if (!open) setPicked(null);
              }}
              open={picked !== null}
              pendingLabel="Signing out…"
              successLabel="Signed out"
              title="Sign out of device?"
            />

            <SettingsConfirmDialog
              confirmLabel="Sign out"
              description="You will be logged out of all other active sessions on other devices, except this one."
              onConfirm={async () => {
                const data = await sdk.RevokeAllSessions({
                  input: { currentSessionId: current?.id ?? sessionId ?? null },
                });
                expectResultMember(
                  data.revokeAllSessions,
                  "AllSessionsRevoked",
                );
                setSessions((list) => list.filter(isCurrent));
              }}
              onOpenChange={setSignOutAllOpen}
              open={signOutAllOpen}
              pendingLabel="Signing out…"
              successLabel="Signed out"
              title="Sign out of all other devices?"
            />
          </div>
        );
      }}
    </SettingsReveal>
  );
}
