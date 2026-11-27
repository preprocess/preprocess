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
import {
  Check,
  Lock,
  Plus,
  TriangleAlertIcon,
  X,
} from "@preprocess/ui/lib/icons";
import { cn } from "@preprocess/ui/lib/utils";
import { useRef, useState, type FormEvent } from "react";

import { NothingCreatedArt } from "../../components/empty-art";

import {
  SettingsConfirmDialog,
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsEmpty,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsSection,
  actionErrorMessage,
} from "../settings/kit";
import { agentNetworkView, sortRules, validatePattern } from "./network-rules";
import type { NetworkRule, NetworkRuleKind } from "./platform-store";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";

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

/** Marks an agent rule that replaces the organization's rule. */
function OverrideBadge() {
  return (
    <Badge className="shrink-0" color="amber" size="sm">
      <span className="flex items-center gap-1">
        <TriangleAlertIcon aria-hidden="true" className="size-3" />
        Overrides organization
      </span>
    </Badge>
  );
}

function Pattern({
  pattern,
  struck = false,
}: Readonly<{ pattern: string; struck?: boolean }>) {
  return (
    <span
      className={cn(
        "truncate text-body",
        struck ? "text-muted-foreground line-through" : "text-foreground",
      )}
      style={{ fontVariationSettings: fontWeights.semibold }}
    >
      {pattern}
    </span>
  );
}

function verb(kind: NetworkRuleKind) {
  return kind === "allow" ? "allows" : "blocks";
}

function AddRuleDialog({
  open,
  onOpenChange,
  existing,
  inherited,
  onAdd,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Patterns this list already has. */
  existing: readonly NetworkRule[];
  /** The organization's rules, on an agent: picking one of its patterns overrides it. */
  inherited?: readonly NetworkRule[];
  onAdd: (rule: NetworkRule) => Promise<unknown>;
}>) {
  const patternRef = useRef<ValidatedFieldHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [pattern, setPattern] = useState("");
  const [kind, setKind] = useState<NetworkRuleKind>("allow");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = pattern.trim().toLowerCase();
  const orgRule = inherited?.find((rule) => rule.pattern === trimmed) ?? null;

  async function add() {
    setError(null);
    if (!patternRef.current?.commit()) throw new AsyncActionAbortError();
    try {
      await onAdd({ pattern: trimmed, kind });
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not add the rule."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      onOpenChange={onOpenChange}
      open={open}
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
          validate={(value) =>
            validatePattern(value) ??
            (existing.some(
              (rule) => rule.pattern === value.trim().toLowerCase(),
            )
              ? "There's already a rule for this host; delete it first."
              : null)
          }
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
        {orgRule && orgRule.kind !== kind ? (
          <SettingsPanelMessage>
            The organization {verb(orgRule.kind)} {orgRule.pattern}. This rule
            overrides it for this agent only.
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

function useRuleDialogs() {
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<NetworkRule | null>(null);
  return { adding, setAdding, deleting, setDeleting };
}

function AddRuleButton({ onClick }: Readonly<{ onClick: () => void }>) {
  return (
    <Button
      leadingIcon={Plus}
      onClick={onClick}
      size="compact"
      type="button"
      variant="secondary"
    >
      Add rule
    </Button>
  );
}

/** The organization's allowlist and blocklist, which every agent inherits. */
export function OrgNetworkSection({
  rules,
  onAdd,
  onDelete,
}: Readonly<{
  rules: readonly NetworkRule[];
  onAdd: (rule: NetworkRule) => Promise<unknown>;
  onDelete: (pattern: string) => Promise<unknown>;
}>) {
  const { adding, setAdding, deleting, setDeleting } = useRuleDialogs();
  return (
    <SettingsSection
      actions={<AddRuleButton onClick={() => setAdding(true)} />}
      description="Hosts every agent's sandbox may or may not reach. An agent can override a rule for itself."
      title="Allowlist and blocklist"
    >
      {rules.length === 0 ? (
        <SettingsEmpty
          art={<NothingCreatedArt />}
          description="Add host rules to control which external domains agents can reach."
          title="No network rules yet"
        />
      ) : (
        <SettingsRows>
          {sortRules(rules).map((rule) => (
            <SettingsRow
              key={rule.pattern}
              label={<Pattern pattern={rule.pattern} />}
            >
              <KindBadge kind={rule.kind} />
              <SettingsRowMenu
                actions={[
                  {
                    label: "Delete",
                    icon: X,
                    onSelect: () => setDeleting(rule),
                  },
                ]}
                label={`Actions for ${rule.pattern}`}
              />
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      {adding ? (
        <AddRuleDialog
          existing={rules}
          onAdd={onAdd}
          onOpenChange={setAdding}
          open
        />
      ) : null}
      <SettingsConfirmDialog
        confirmLabel="Delete"
        description="Agents follow the remaining rules on their next run."
        onConfirm={() =>
          deleting ? onDelete(deleting.pattern) : Promise.resolve()
        }
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        open={deleting !== null}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title={deleting ? `Delete the rule for ${deleting.pattern}?` : "Delete"}
      />
    </SettingsSection>
  );
}

/**
 * One agent's network rules on top of the organization's. Inherited rules
 * are locked; the agent's own rules that replace one are marked
 * "Overrides organization", and the rule they replace shows as overridden.
 */
export function AgentNetworkSection({
  title,
  organization,
  rules,
  onAdd,
  onDelete,
}: Readonly<{
  /** Set when the section shares a page with others. */
  title?: string;
  organization: readonly NetworkRule[];
  rules: readonly NetworkRule[];
  onAdd: (rule: NetworkRule) => Promise<unknown>;
  onDelete: (pattern: string) => Promise<unknown>;
}>) {
  const { adding, setAdding, deleting, setDeleting } = useRuleDialogs();
  const view = agentNetworkView(organization, rules);

  return (
    <SettingsSection
      actions={<AddRuleButton onClick={() => setAdding(true)} />}
      description={
        view.overrideCount > 0
          ? `This agent overrides ${view.overrideCount} organization ${view.overrideCount === 1 ? "rule" : "rules"}. Its own rules win for their hosts.`
          : "This agent follows the organization's rules, managed in Developers → Network. Rules added here apply to it alone."
      }
      title={title}
    >
      <SettingsRows>
        {sortRules(view.own).map(({ rule, overrides }) => (
          <SettingsRow
            description={
              overrides
                ? `The organization ${verb(overrides.kind)} this host`
                : "This agent only"
            }
            key={`agent:${rule.pattern}`}
            label={<Pattern pattern={rule.pattern} />}
          >
            {overrides ? <OverrideBadge /> : null}
            <KindBadge kind={rule.kind} />
            <SettingsRowMenu
              actions={[
                { label: "Delete", icon: X, onSelect: () => setDeleting(rule) },
              ]}
              label={`Actions for ${rule.pattern}`}
            />
          </SettingsRow>
        ))}
        {sortRules(view.inherited).map(({ rule, overriddenBy }) => (
          <SettingsRow
            description={
              overriddenBy
                ? "From the organization · overridden for this agent"
                : "From the organization"
            }
            key={`org:${rule.pattern}`}
            label={
              <Pattern pattern={rule.pattern} struck={overriddenBy !== null} />
            }
          >
            <Badge className="shrink-0" size="sm">
              <span className="flex items-center gap-1">
                <Lock aria-hidden="true" className="size-3" />
                {overriddenBy ? "Overridden" : "Organization"}
              </span>
            </Badge>
            <span className={cn(overriddenBy && "opacity-50")}>
              <KindBadge kind={rule.kind} />
            </span>
          </SettingsRow>
        ))}
      </SettingsRows>
      {adding ? (
        <AddRuleDialog
          existing={rules}
          inherited={organization}
          onAdd={onAdd}
          onOpenChange={setAdding}
          open
        />
      ) : null}
      <SettingsConfirmDialog
        confirmLabel="Delete"
        description={
          deleting &&
          organization.some((rule) => rule.pattern === deleting.pattern)
            ? "The organization's rule for this host applies again."
            : "The agent follows the organization's rules for this host."
        }
        onConfirm={() =>
          deleting ? onDelete(deleting.pattern) : Promise.resolve()
        }
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        open={deleting !== null}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title={deleting ? `Delete the rule for ${deleting.pattern}?` : "Delete"}
      />
    </SettingsSection>
  );
}
