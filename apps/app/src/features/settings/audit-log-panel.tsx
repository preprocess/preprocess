"use client";

// The organization's audit log: every recorded action in chain order, and a
// check that the hash chain and each day's signed manifest still agree.

import {
  Banner,
  BannerDescription,
  BannerTitle,
} from "@preprocess/ui/components/banner";
import { Button } from "@preprocess/ui/components/button";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@preprocess/ui/components/table";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useOrganizationId } from "../auth/auth-context";
import { orgApi } from "../auth/client";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsError,
  SettingsReveal,
  SettingsSection,
  SettingsSkeletonRows,
} from "./kit";
import { SettingsStacked } from "./settings-widgets";

type AuditEvent = {
  id: string;
  seq: number;
  occurredAt: string;
  actorType: "person" | "agent" | "api_key" | "platform";
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
};

type Verification = {
  ok: boolean;
  checkedThroughSeq: number;
  anchorsChecked: number;
  firstBreak?: {
    seq: number;
    reason: "hash_mismatch" | "gap" | "anchor_mismatch" | "anchor_missing";
  };
};

const BREAK_REASONS: Record<
  NonNullable<Verification["firstBreak"]>["reason"],
  string
> = {
  hash_mismatch: "its hash doesn't match its contents",
  gap: "an event is missing before it",
  anchor_mismatch: "a signed daily manifest disagrees with the chain",
  anchor_missing: "a day's signed manifest is missing",
};

const PAGE = 100;

const timestamp = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "medium",
});

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function VerifyChain({ organizationId }: { organizationId: string }) {
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState<unknown>(null);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <LoadingButton
          className="w-auto"
          onAction={async () => {
            setError(null);
            setResult(
              await orgApi<Verification>(
                organizationId,
                "/audit-events/verify",
                { method: "POST" },
              ),
            );
          }}
          onError={setError}
          pendingLabel="Verifying…"
          successLabel="Verified"
        >
          Verify chain
        </LoadingButton>
      </div>
      {error ? <SettingsError error={error} /> : null}
      {result?.ok ? (
        <Banner status="success">
          <BannerTitle>The audit log is intact</BannerTitle>
          <BannerDescription>
            {result.checkedThroughSeq === 0
              ? "There are no events to check yet."
              : `Every event through #${result.checkedThroughSeq} links to the one before it, and ${plural(result.anchorsChecked, "signed daily manifest matches", "signed daily manifests match")} the chain.`}
          </BannerDescription>
        </Banner>
      ) : null}
      {result && !result.ok && result.firstBreak ? (
        <Banner status="error">
          <BannerTitle>The audit log doesn't verify</BannerTitle>
          <BannerDescription>
            {`The chain breaks at event #${result.firstBreak.seq}: ${BREAK_REASONS[result.firstBreak.reason]}.`}
          </BannerDescription>
        </Banner>
      ) : null}
    </div>
  );
}

export function AuditLogPanel() {
  const organizationId = useOrganizationId();
  const people = useQuery({
    queryKey: ["members", organizationId, "names"],
    queryFn: () =>
      orgApi<{ userId: string; name: string }[]>(organizationId, "/members"),
    select: (members) =>
      new Map(members.map((member) => [member.userId, member.name])),
  });
  const events = useInfiniteQuery({
    queryKey: ["audit-events", organizationId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      orgApi<{ events: AuditEvent[]; next: number | null }>(
        organizationId,
        `/audit-events?limit=${PAGE}&after=${pageParam}`,
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });

  const actor = (event: AuditEvent) =>
    event.actorType === "person"
      ? (people.data?.get(event.actorId) ?? event.actorId)
      : event.actorType === "platform"
        ? "Preprocess"
        : event.actorId;

  return (
    <SettingsStacked>
      <SettingsSection
        description="Each event is hashed with the one before it, and each day's chain is signed. Verifying recomputes every hash and checks every signed manifest."
        title="Verification"
      >
        <VerifyChain organizationId={organizationId} />
      </SettingsSection>
      <SettingsSection title="Events">
        {events.isError ? (
          <SettingsError error={events.error} />
        ) : (
          <SettingsReveal
            data={events.data}
            skeleton={<SettingsSkeletonRows count={4} />}
          >
            {(data) => {
              const list = data.pages.flatMap((page) => page.events);
              if (list.length === 0)
                return (
                  <SettingsEmpty
                    description="Actions in this organization will show up here."
                    title="No events yet"
                  />
                );
              return (
                <div className="flex flex-col gap-3">
                  <SettingsCard table>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-14">#</TableHead>
                          <TableHead className="w-48">When</TableHead>
                          <TableHead className="w-36">Who</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.map((event, index) => (
                          <TableRow index={index} key={event.id}>
                            <TableCell className="text-muted-foreground tabular-nums">
                              {event.seq}
                            </TableCell>
                            <TableCell>
                              <time dateTime={event.occurredAt}>
                                {timestamp.format(new Date(event.occurredAt))}
                              </time>
                            </TableCell>
                            <TableCell>
                              <span className="truncate" title={event.actorId}>
                                {actor(event)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <code className="text-caption">
                                {event.action}
                              </code>
                              {event.targetId ? (
                                <span className="ml-2 text-caption text-muted-foreground">
                                  {event.targetId}
                                </span>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </SettingsCard>
                  {events.hasNextPage ? (
                    <div className="flex justify-end">
                      <Button
                        disabled={events.isFetchingNextPage}
                        onClick={() => void events.fetchNextPage()}
                        size="compact"
                        type="button"
                        variant="secondary"
                      >
                        Load more
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            }}
          </SettingsReveal>
        )}
      </SettingsSection>
    </SettingsStacked>
  );
}
