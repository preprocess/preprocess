import { Badge } from "@preprocess/ui/components/badge";
import { InputCopy } from "@preprocess/ui/components/input-copy";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { createContext, useContext, type ReactNode } from "react";

import { SettingsRows, SettingsSection, formatDate } from "../settings/kit";
import { awaitingPhrase, formatCost, type Case } from "./case";
import {
  AssigneeStack,
  NeedsAssignmentTag,
  assigneesLabel,
} from "./assignee-stack";
import { CaseStatusIcon } from "./case-status-icon";
import { HALT_REASONS } from "./case-room-state";
import { groupName } from "./case-room-review";
import { useCaseWork } from "./case-work-context";

/** The open case, for views deep in the workspace panes. */
export const CaseRecordContext = createContext<Case | null>(null);

export function useCaseRecord() {
  return useContext(CaseRecordContext);
}

function Property({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex min-h-11 items-center gap-4 px-4 py-2">
      <span className="w-24 shrink-0 text-body text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-body text-foreground">
        {children}
      </div>
    </div>
  );
}

function Muted({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="text-muted-foreground">{children}</span>;
}

/** The Details inspector: the case's properties, beside the work. */
export function CaseRoomDetails({ item }: Readonly<{ item: Case }>) {
  const room = useCaseWork()?.room;
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-5">
        {room && room.status !== "queued" ? (
          <SettingsSection title="Run">
            <SettingsRows>
              <Property label="Runs">{room.run}</Property>
              {room.waitingOn ? (
                <Property label="Waiting on">
                  <Badge size="sm">{groupName(room.waitingOn.group)}</Badge>
                  {room.waitingOn.reason ? (
                    <Muted>{room.waitingOn.reason}</Muted>
                  ) : null}
                </Property>
              ) : null}
              {room.status === "halted" ? (
                <Property label="Halted">
                  {HALT_REASONS[room.reason ?? ""] ?? room.reason}
                </Property>
              ) : null}
              {room.status === "failed" && room.reason ? (
                <Property label="Failed">{room.reason}</Property>
              ) : null}
            </SettingsRows>
          </SettingsSection>
        ) : null}
        <SettingsSection title="Properties">
          <SettingsRows>
            <Property label="Status">
              <CaseStatusIcon status={item.status} />
              {item.status}
            </Property>
            <Property label="Agent">
              <Badge size="sm">{item.agentId}</Badge>
            </Property>
            <Property label="Waiting on">
              {awaitingPhrase(item.awaiting) ? (
                <>
                  <Badge size="sm">{awaitingPhrase(item.awaiting)}</Badge>
                  <NeedsAssignmentTag item={item} />
                </>
              ) : (
                <Muted>No one</Muted>
              )}
            </Property>
            <Property label="Assignees">
              {item.assignees.length > 0 ? (
                <>
                  <AssigneeStack assignees={item.assignees} max={5} />
                  <span className="truncate">
                    {assigneesLabel(item.assignees)}
                  </span>
                </>
              ) : (
                <Muted>Unassigned</Muted>
              )}
            </Property>
          </SettingsRows>
        </SettingsSection>
        <SettingsSection title="Record">
          <SettingsRows>
            <Property label="Created">{formatDate(item.createdAt)}</Property>
            <Property label="Updated">{formatDate(item.updatedAt)}</Property>
            <Property label="Cost">{formatCost(item.costCents)}</Property>
            <Property label="Case ID">
              <InputCopy className="min-w-0 flex-1" value={item.id} />
            </Property>
            {item.externalId ? (
              <Property label="External ID">
                <InputCopy className="min-w-0 flex-1" value={item.externalId} />
              </Property>
            ) : null}
          </SettingsRows>
        </SettingsSection>
      </div>
    </ScrollArea>
  );
}
