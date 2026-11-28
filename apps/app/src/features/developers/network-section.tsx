import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Check, Plus, X } from "@preprocess/ui/lib/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";

import { NetworkRulesArt } from "../../components/empty-art";

import { useOrganizationId } from "../auth/auth-context";
import { orgApi } from "../auth/client";
import {
  SettingsConfirmDialog,
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsEmpty,
  SettingsError,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsSection,
  SettingsSkeletonRows,
  actionErrorMessage,
} from "../settings/kit";
import { useCanAdminister } from "../settings/use-role";
import { sortRules, validatePattern } from "./network-rules";
import type { NetworkRule, NetworkRuleKind } from "./platform-store";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";

/**
 * Developers → Network: the organization's network guardrail
 * (/v1/orgs/:org/guardrails). Agent code reaches a host when no block
 * pattern matches it and the allow list is empty or matches it. Agents can
 * only narrow these rules.
 */

type Rules = { allow: string[]; block: string[] };

const KIND = {
  allow: { label: "Allow", color: "green", icon: Check },
  block: { label: "Block", color: "red", icon: X },
} as const;

function KindBadge({ kind }: Readonly<{ kind: NetworkRuleKind }>) {
  const { label, color, icon: Icon } = KIND[kind];
  return (
    <Badge className="shrink-0" color={color} size="sm">
      <span className="flex items-center gap-1">
        <Icon aria-hidden="true" className="size-3" />
        {label}
      </span>
    </Badge>
  );
}

function toRules(rules: Rules): NetworkRule[] {
  return [
    ...rules.allow.map((pattern) => ({ pattern, kind: "allow" as const })),
    ...rules.block.map((pattern) => ({ pattern, kind: "block" as const })),
  ];
}

function AddRuleDialog({
  existing,
  onOpenChange,
  onAdd,
}: Readonly<{
  existing: Rules;
  onOpenChange: (open: boolean) => void;
  onAdd: (rule: NetworkRule) => Promise<unknown>;
}>) {
  const patternRef = useRef<ValidatedFieldHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [pattern, setPattern] = useState("");
  const [kind, setKind] = useState<NetworkRuleKind>("allow");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    if (!patternRef.current?.commit()) throw new AsyncActionAbortError();
    try {
      await onAdd({ pattern: pattern.trim().toLowerCase(), kind });
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not add the rule."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      onOpenChange={onOpenChange}
      open
      title="Add network rule"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        <ValidatedField
          autoFocus
          hint="A host, or *.example.com for every subdomain."
          id="network-pattern"
          label="Host"
          onChange={setPattern}
          placeholder="api.example.com"
          ref={patternRef}
          validate={(value) => {
            const next = value.trim().toLowerCase();
            return (
              validatePattern(next) ??
              ([...existing.allow, ...existing.block].includes(next)
                ? "There's already a rule for this host; delete it first."
                : null)
            );
          }}
          value={pattern}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-body text-foreground">Rule</span>
          <Select
            onValueChange={(value) =>
              setKind(value === "block" ? "block" : "allow")
            }
            value={kind}
          >
            <SelectTrigger aria-label="Rule" />
            <SelectContent>
              <SelectItem index={0} value="allow">
                Allow
              </SelectItem>
              <SelectItem index={1} value="block">
                Block
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {kind === "allow" && existing.allow.length === 0 ? (
          <SettingsPanelMessage>
            Your first allow rule turns on the allow list: agents can then reach
            only the hosts you allow.
          </SettingsPanelMessage>
        ) : null}
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
        <SettingsDialogActions
          onCancel={() => onOpenChange(false)}
          pending={pending}
        >
          <LoadingButton
            onAction={add}
            onStatusChange={(status) => setPending(status === "pending")}
            pendingLabel="Adding…"
            ref={saveRef}
            successLabel="Added"
            type="submit"
          >
            Add rule
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}

/** The organization's allowlist and blocklist, which every agent inherits. */
export function OrgNetworkSection() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const canEdit = useCanAdminister();
  const queryKey = ["guardrails", organizationId];
  const guardrails = useQuery({
    queryKey,
    queryFn: () => orgApi<{ network: Rules }>(organizationId, "/guardrails"),
  });
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<
    (NetworkRule & { lastAllow: boolean }) | null
  >(null);
  const saved = guardrails.data?.network;

  async function save(next: Rules) {
    await orgApi(organizationId, "/guardrails/network", {
      method: "PUT",
      body: JSON.stringify(next),
    });
    await queryClient.invalidateQueries({ queryKey });
  }

  return (
    <SettingsSection
      actions={
        canEdit ? (
          <Button
            disabled={!saved}
            leadingIcon={Plus}
            onClick={() => setAdding(true)}
            size="compact"
            type="button"
            variant="secondary"
          >
            Add rule
          </Button>
        ) : null
      }
      description="Hosts every agent's code may reach. With no allow rules, every host that isn't blocked is reachable. Agents can only narrow these."
      title="Allowlist and blocklist"
    >
      {guardrails.isError ? (
        <SettingsError error={guardrails.error} />
      ) : !saved ? (
        <SettingsSkeletonRows count={3} />
      ) : saved.allow.length + saved.block.length === 0 ? (
        <SettingsEmpty
          art={<NetworkRulesArt />}
          description="Agents can reach every host. Add host rules to control which external domains agents can reach."
          title="No network rules yet"
        />
      ) : (
        <SettingsRows>
          {sortRules(toRules(saved)).map((rule) => (
            <SettingsRow
              key={`${rule.kind}:${rule.pattern}`}
              label={
                <span
                  className="truncate text-body text-foreground"
                  style={{ fontVariationSettings: fontWeights.medium }}
                >
                  {rule.pattern}
                </span>
              }
            >
              <KindBadge kind={rule.kind} />
              {canEdit ? (
                <SettingsRowMenu
                  actions={[
                    {
                      label: "Delete",
                      icon: X,
                      onSelect: () =>
                        setDeleting({
                          ...rule,
                          lastAllow:
                            rule.kind === "allow" && saved.allow.length === 1,
                        }),
                    },
                  ]}
                  label={`Actions for ${rule.pattern}`}
                />
              ) : null}
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      {adding && saved ? (
        <AddRuleDialog
          existing={saved}
          onAdd={(rule) =>
            save({ ...saved, [rule.kind]: [...saved[rule.kind], rule.pattern] })
          }
          onOpenChange={setAdding}
        />
      ) : null}
      <SettingsConfirmDialog
        confirmLabel="Delete"
        description={
          deleting?.lastAllow
            ? "This is the last allow rule: agents can then reach every host that isn't blocked."
            : "Agents follow the remaining rules on their next call."
        }
        onConfirm={async () => {
          if (!deleting || !saved) return;
          await save({
            ...saved,
            [deleting.kind]: saved[deleting.kind].filter(
              (pattern) => pattern !== deleting.pattern,
            ),
          });
        }}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        open={deleting !== null}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title={deleting ? `Delete the rule for ${deleting.pattern}?` : "Delete"}
      />
    </SettingsSection>
  );
}
