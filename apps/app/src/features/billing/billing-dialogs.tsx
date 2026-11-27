"use client";

// Billing's dialogs (Design round 4): Change plan, Upgrade to Team with its
// first top-up, Top up credits, the Team cancel flow (What changes, Pick 3
// active seats, Cancel Team plan) and Restore previous roles. Rows sit on the
// dialog surface with hairline dividers, never in a nested card.

import { Badge } from "@preprocess/ui/components/badge";
import { Banner, BannerTitle } from "@preprocess/ui/components/banner";
import { Button } from "@preprocess/ui/components/button";
import {
  CheckboxGroup,
  CheckboxItem,
} from "@preprocess/ui/components/checkbox-group";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { RadioGroup, RadioItem } from "@preprocess/ui/components/radio-group";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { ArrowUpRight } from "@preprocess/ui/lib/icons";
import { useRef, useState, type ReactNode } from "react";

import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";
import { useOrganizationId } from "../auth/auth-context";
import { useOrganizations } from "../organizations/organizations-context";
import { SettingsDialogShell, SettingsRow } from "../settings/kit";
import { useBillingActions, useChangePreview } from "./billing-api";
import {
  cardLabel,
  count,
  creditsUsd,
  dollarsOf,
  longDate,
  monthName,
  PLAN_NAME,
  PLAN_SUMMARY,
  topUpAmount,
  usd,
} from "./billing-format";
import type { Billing, ChangeItem, Plan, Purchase } from "./billing-types";

export type BillingDialog =
  | null
  | { kind: "plan" }
  | { kind: "upgrade" }
  | { kind: "topup" }
  | { kind: "cancel"; from: "page" | "plan" }
  | { kind: "restore" };

const SALES_URL = "https://preprocess.com/book";
const medium = { fontVariationSettings: fontWeights.medium };

const DialogRows = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col divide-y divide-border">{children}</div>
);

const balanceOf = (billing: Billing) =>
  billing.credits
    ? creditsUsd(billing.credits.remaining - billing.credits.owed)
    : 0;

const go = (url: string) => window.location.assign(url);

function PlanDialog({
  billing,
  onClose,
  onUpgrade,
  onSwitchToFree,
}: {
  billing: Billing;
  onClose: () => void;
  onUpgrade: () => void;
  onSwitchToFree: () => void;
}) {
  const current = billing.plan;
  const action = (plan: Plan) => {
    if (plan === current) return null;
    if (plan === "team" && current === "free")
      return (
        <Button onClick={onUpgrade} type="button">
          Upgrade
        </Button>
      );
    if (plan === "free" && current === "team")
      return (
        <Button onClick={onSwitchToFree} type="button" variant="secondary">
          Switch to Free
        </Button>
      );
    if (plan === "free") return null;
    return (
      <Button
        render={<a href={SALES_URL} rel="noreferrer" target="_blank" />}
        trailingIcon={ArrowUpRight}
        variant="secondary"
      >
        Contact us
      </Button>
    );
  };
  return (
    <SettingsDialogShell
      description="Compare plans or move to a different tier."
      footer={
        <Button onClick={onClose} type="button" variant="secondary">
          Close
        </Button>
      }
      onOpenChange={(open) => (open ? null : onClose())}
      open
      size="lg"
      title="Change plan"
    >
      <DialogRows>
        {(["free", "team", "enterprise"] as const).map((plan) => (
          <SettingsRow
            className="px-0"
            description={PLAN_SUMMARY[plan]}
            key={plan}
            label={
              <span className="flex items-center gap-2">
                <span style={medium}>{PLAN_NAME[plan]}</span>
                {plan === current ? (
                  <Badge size="compact">Current plan</Badge>
                ) : null}
              </span>
            }
          >
            {action(plan)}
          </SettingsRow>
        ))}
      </DialogRows>
    </SettingsDialogShell>
  );
}

function UpgradeDialog({
  billing,
  onBack,
  onClose,
}: {
  billing: Billing;
  onBack: () => void;
  onClose: () => void;
}) {
  const actions = useBillingActions();
  const [first, setFirst] = useState("10");
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "payment"; url: string } | { kind: "error" }
  >({ kind: "idle" });
  const field = useRef<ValidatedFieldHandle>(null);
  const valid = topUpAmount(first) === null;
  const amount = valid ? dollarsOf(first) : 0;
  const balance = balanceOf(billing);
  const due = valid ? usd(amount) : "—";
  const label =
    state.kind === "payment"
      ? "Confirm payment"
      : valid
        ? `Upgrade and pay ${due}`
        : "Upgrade to Team";
  const creditsLine = valid
    ? balance > 0
      ? `${usd(balance + amount)} after upgrade (${usd(balance)} carries over)`
      : `${usd(amount)} after upgrade`
    : balance > 0
      ? `Your ${usd(balance)} balance carries over, plus your first top-up`
      : "Your first top-up is added today";

  const upgrade = async () => {
    if (state.kind === "payment") return go(state.url);
    if (!field.current?.commit()) throw new Error("invalid");
    let purchase: Purchase;
    try {
      purchase = await actions.upgrade(amount * 100);
    } catch (cause) {
      setState({ kind: "error" });
      throw cause;
    }
    if (purchase.url && purchase.action === "confirm_payment") {
      setState({ kind: "payment", url: purchase.url });
      return;
    }
    if (purchase.url && purchase.action === "card_declined") {
      setState({ kind: "error" });
      throw new Error("declined");
    }
    if (purchase.url) return go(purchase.url);
    onClose();
  };

  return (
    <SettingsDialogShell
      description="Review the change before you confirm."
      footer={
        <>
          <Button onClick={onBack} type="button" variant="secondary">
            Back
          </Button>
          <LoadingButton
            errorLabel={label}
            onAction={upgrade}
            pendingLabel="Upgrading…"
            successLabel="Upgraded"
          >
            {label}
          </LoadingButton>
        </>
      }
      onOpenChange={(open) => (open ? null : onClose())}
      open
      size="lg"
      title="Upgrade to Team"
    >
      <div className="flex flex-col gap-4">
        <ValidatedField
          hint="Added to your credit balance today. $10 minimum."
          id="first-topup"
          inputMode="numeric"
          label="First top-up"
          onChange={setFirst}
          onBlur={() => field.current?.commit()}
          ref={field}
          validate={topUpAmount}
          value={first}
        />
        <DialogRows>
          <SettingsRow className="min-h-12 px-0" label="Due today">
            <span className="text-body tabular-nums text-foreground">
              {due}
            </span>
          </SettingsRow>
          <SettingsRow className="min-h-12 px-0" label="Seats">
            <span className="text-body text-muted-foreground">
              $16 per active seat, billed at month end
            </span>
          </SettingsRow>
          <SettingsRow className="min-h-12 px-0" label="Credits">
            <span className="text-body text-muted-foreground">
              {creditsLine}
            </span>
          </SettingsRow>
        </DialogRows>
        {state.kind === "payment" ? (
          <Banner status="warning">
            <BannerTitle>Confirm your card before upgrading.</BannerTitle>
          </Banner>
        ) : state.kind === "error" ? (
          <Banner status="error">
            <BannerTitle>
              Couldn't change your plan. Try again or contact support.
            </BannerTitle>
          </Banner>
        ) : null}
      </div>
    </SettingsDialogShell>
  );
}

const PRESETS = ["50", "100", "250", "500"] as const;

function TopUpDialog({
  billing,
  onClose,
}: {
  billing: Billing;
  onClose: () => void;
}) {
  const actions = useBillingActions();
  const hasCard = billing.started && Boolean(billing.card);
  const [amount, setAmount] = useState("100");
  const [other, setOther] = useState("");
  const [pay, setPay] = useState(hasCard ? "card" : "new");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "auth"; url: string }
    | { kind: "declined" }
    | { kind: "error" }
    | { kind: "success"; added: number; balance: number }
  >({ kind: "idle" });
  const otherField = useRef<ValidatedFieldHandle>(null);
  const dollars =
    amount === "other"
      ? topUpAmount(other) === null
        ? dollarsOf(other)
        : null
      : Number(amount);
  const newCard = pay === "new" || !hasCard;

  if (state.kind === "success")
    return (
      <SettingsDialogShell
        description="Add prepaid credits to cover usage charges."
        footer={
          <Button onClick={onClose} type="button">
            Done
          </Button>
        }
        onOpenChange={(open) => (open ? null : onClose())}
        open
        size="lg"
        title="Top up credits"
      >
        <Banner status="success">
          <BannerTitle>{`Added ${usd(state.added)}. Your balance is now ${usd(state.balance)}.`}</BannerTitle>
        </Banner>
      </SettingsDialogShell>
    );

  const label =
    state.kind === "auth"
      ? "Confirm payment"
      : state.kind === "declined"
        ? "Try another card"
        : dollars === null
          ? "Add credits"
          : newCard
            ? `Pay ${usd(dollars)}`
            : `Add ${usd(dollars)}`;
  const redirects = newCard || state.kind === "declined";

  const buy = async () => {
    if (state.kind === "auth") return go(state.url);
    if (amount === "other" && !otherField.current?.commit())
      throw new Error("invalid");
    if (dollars === null) throw new Error("invalid");
    const anotherCard = newCard || state.kind === "declined";
    let purchase: Purchase;
    try {
      purchase = await actions.buyCredits(dollars * 100, anotherCard);
    } catch (cause) {
      setState({ kind: "error" });
      throw cause;
    }
    if (purchase.url && purchase.action === "confirm_payment")
      return setState({ kind: "auth", url: purchase.url });
    if (purchase.url && purchase.action === "card_declined")
      return setState({ kind: "declined" });
    if (purchase.url) return go(purchase.url);
    setState({
      kind: "success",
      added: dollars,
      balance: balanceOf(billing) + dollars,
    });
  };

  return (
    <SettingsDialogShell
      description="Add prepaid credits to cover usage charges."
      footer={
        <>
          <Button onClick={onClose} type="button" variant="secondary">
            Cancel
          </Button>
          <LoadingButton
            errorLabel={label}
            onAction={buy}
            pendingLabel={redirects ? "Redirecting…" : "Adding…"}
            successLabel={redirects ? "Redirecting…" : "Added"}
          >
            {label}
          </LoadingButton>
        </>
      }
      onOpenChange={(open) => (open ? null : onClose())}
      open
      size="lg"
      title="Top up credits"
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-body text-foreground">Amount</span>
          <RadioGroup
            className="w-full"
            onValueChange={setAmount}
            value={amount}
          >
            {[
              ...PRESETS.map((p) => ({ value: p, label: `$${p}` })),
              { value: "other", label: "Other amount" },
            ].map((option, i) => (
              <RadioItem
                index={i}
                key={option.value}
                label={option.label}
                value={option.value}
              />
            ))}
          </RadioGroup>
          {amount === "other" ? (
            <ValidatedField
              id="topup-other"
              inputMode="numeric"
              label="Other amount"
              onChange={setOther}
              placeholder="$10–$5,000, whole dollars"
              onBlur={() => otherField.current?.commit()}
              ref={otherField}
              validate={topUpAmount}
              value={other}
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-body text-foreground">Pay with</span>
          <RadioGroup className="w-full" onValueChange={setPay} value={pay}>
            {hasCard && billing.card ? (
              <RadioItem
                index={0}
                label={`${cardLabel(billing.card)} · Charged now`}
                value="card"
              />
            ) : null}
            <RadioItem
              index={hasCard ? 1 : 0}
              label="Use another card · Enter a different card at checkout"
              value="new"
            />
          </RadioGroup>
          {hasCard ? null : (
            <span className="text-caption text-muted-foreground">
              No card on file. Your card will be saved for future charges.
            </span>
          )}
        </div>
        {state.kind === "auth" ? (
          <Banner status="warning">
            <BannerTitle>Your bank needs to confirm this payment.</BannerTitle>
          </Banner>
        ) : state.kind === "declined" ? (
          <Banner status="error">
            <BannerTitle>Your card was declined. Try another card.</BannerTitle>
          </Banner>
        ) : state.kind === "error" ? (
          <Banner status="error">
            <BannerTitle>
              Couldn't add credits. Try again or contact support.
            </BannerTitle>
          </Banner>
        ) : null}
      </div>
    </SettingsDialogShell>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 py-4">
      <span className="text-body text-foreground">{label}</span>
      {children}
    </div>
  );
}

const Body = ({ children }: { children: ReactNode }) => (
  <span className="text-caption text-muted-foreground">{children}</span>
);

const REASONS = [
  "Too expensive",
  "Not using it enough",
  "Missing a feature",
  "Switching to self-hosted",
  "Project ended",
  "Other",
] as const;

const SEATS_BODY =
  "Free includes 3 developer and operator seats. Choose who keeps access—everyone else becomes a free viewer. If you don't pick, Owners keep access first, then the most recently active.";

function CancelFlow({
  from,
  fallbackDate,
  onBack,
  onClose,
}: {
  from: "page" | "plan";
  fallbackDate: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const actions = useBillingActions();
  const preview = useChangePreview(true);
  const [step, setStep] = useState<"changes" | "seats" | "confirm">("changes");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState(false);
  const close = (open: boolean) => (open ? null : onClose());

  const items = preview.data?.items ?? [];
  const date = preview.data?.at ? longDate(preview.data.at) : fallbackDate;
  const seats = items.find(
    (i): i is Extract<ChangeItem, { kind: "seats" }> => i.kind === "seats",
  );
  const keep =
    picked ?? seats?.people.filter((p) => p.keeps).map((p) => p.userId) ?? [];
  const finalMonth = preview.data?.at
    ? monthName(
        new Date(new Date(preview.data.at).getTime() - 86_400_000)
          .toISOString()
          .slice(0, 7),
      )
    : null;

  if (step === "seats" && seats)
    return (
      <SettingsDialogShell
        description={SEATS_BODY}
        footer={
          <>
            <span className="mr-auto self-center text-caption tabular-nums text-muted-foreground">
              {`${draft.length} of ${seats.limit} selected`}
            </span>
            <Button
              onClick={() => setStep("changes")}
              type="button"
              variant="secondary"
            >
              Back
            </Button>
            <Button
              disabled={draft.length > seats.limit}
              onClick={() => {
                setPicked(draft);
                setStep("changes");
              }}
              type="button"
            >
              Done
            </Button>
          </>
        }
        onOpenChange={close}
        open
        size="lg"
        title={`Pick ${seats.limit} active seats`}
      >
        <CheckboxGroup
          checkedIndices={
            new Set(
              seats.people.flatMap((p, i) =>
                draft.includes(p.userId) ? [i] : [],
              ),
            )
          }
          className="w-full"
        >
          {seats.people.map((person, i) => (
            <CheckboxItem
              checked={draft.includes(person.userId)}
              index={i}
              key={person.userId}
              label={`${person.name} · ${person.email}`}
              onToggle={() =>
                setDraft((current) =>
                  current.includes(person.userId)
                    ? current.filter((id) => id !== person.userId)
                    : [...current, person.userId],
                )
              }
            />
          ))}
        </CheckboxGroup>
      </SettingsDialogShell>
    );

  if (step === "confirm")
    return (
      <SettingsDialogShell
        description={`Team ends on ${date}. No seat charges after that.${finalMonth ? ` Your final invoice on ${date} covers ${finalMonth}.` : ""}`}
        footer={
          <>
            <Button
              onClick={() => setStep("changes")}
              type="button"
              variant="secondary"
            >
              Back
            </Button>
            <LoadingButton
              errorLabel="Cancel plan"
              onAction={async () => {
                setFailed(false);
                try {
                  await actions.switchToFree(
                    seats ? keep : undefined,
                    reason || undefined,
                  );
                } catch (cause) {
                  setFailed(true);
                  throw cause;
                }
                onClose();
              }}
              pendingLabel="Cancelling…"
              successLabel="Cancelled"
            >
              Cancel plan
            </LoadingButton>
          </>
        }
        onOpenChange={close}
        open
        size="lg"
        title="Cancel Team plan"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-body text-foreground">
              Why are you cancelling? (optional)
            </span>
            <RadioGroup
              className="w-full"
              onValueChange={setReason}
              value={reason}
            >
              {REASONS.map((option, i) => (
                <RadioItem
                  index={i}
                  key={option}
                  label={option}
                  value={option}
                />
              ))}
            </RadioGroup>
          </div>
          {failed ? (
            <Banner status="error">
              <BannerTitle>
                Couldn't cancel your plan. Try again or contact support.
              </BannerTitle>
            </Banner>
          ) : null}
        </div>
      </SettingsDialogShell>
    );

  const names = seats
    ? seats.people
        .filter((p) => keep.includes(p.userId))
        .map((p) => p.name)
        .join(", ")
    : "";

  return (
    <SettingsDialogShell
      description="Cases already running finish normally. Your credit balance and auto-reload carry over, and nothing is deleted."
      footer={
        <>
          <Button
            onClick={from === "plan" ? onBack : onClose}
            type="button"
            variant="secondary"
          >
            {from === "plan" ? "Back" : "Close"}
          </Button>
          <Button
            disabled={!preview.data}
            onClick={() => setStep("confirm")}
            type="button"
          >
            Continue
          </Button>
        </>
      }
      onOpenChange={close}
      open
      size="lg"
      title={`What changes on ${date}`}
    >
      {preview.isError ? (
        <Banner status="error">
          <BannerTitle>Couldn't load what changes. Try again.</BannerTitle>
        </Banner>
      ) : !preview.data ? null : items.length === 0 ? (
        <DialogRows>
          <Item label="Nothing else changes.">
            <Body>
              Your organization moves to Free at the end of this billing period,
              and no seat charges follow.
            </Body>
          </Item>
        </DialogRows>
      ) : (
        <DialogRows>
          {items.map((item) =>
            item.kind === "seats" ? (
              <Item key="seats" label={`Pick ${item.limit} active seats`}>
                <Body>{SEATS_BODY}</Body>
                <div className="mt-1 flex items-center justify-between gap-4">
                  <span className="text-body text-foreground">
                    {names}{" "}
                    <span className="text-muted-foreground">
                      {`· ${keep.length} of ${item.limit} selected`}
                    </span>
                  </span>
                  <Button
                    onClick={() => {
                      setDraft(keep);
                      setStep("seats");
                    }}
                    size="compact"
                    type="button"
                    variant="secondary"
                  >
                    Change
                  </Button>
                </div>
              </Item>
            ) : item.kind === "agents" ? (
              <Item
                key="agents"
                label="Agents with custom environments will pause"
              >
                <Body>
                  {`Custom sandbox setups require Team. These agents pause for new cases on ${date}: ${item.agents.map((a) => a.slug).join(", ")}. All other agents keep running.`}
                </Body>
                <Body>
                  Remove the custom setup in code to keep them running, or
                  upgrade later to resume automatically.
                </Body>
              </Item>
            ) : item.kind === "storage" ? (
              <Item
                key="storage"
                label={`Storage over ${item.includedGb} GB bills at $0.10/GB-month`}
              >
                <Body>
                  {`You're using ${item.gb.toLocaleString("en-US", { maximumFractionDigits: 1 })} GB (${(item.gb - item.includedGb).toLocaleString("en-US", { maximumFractionDigits: 1 })} GB over Free's ${item.includedGb} GB allowance, about ${usd(item.usdPerMonth)}/month at current usage). Overage bills to your card at month end.`}
                </Body>
              </Item>
            ) : (
              <Item
                key="cases"
                label={`Case limit drops to ${count(item.limit)} a month`}
              >
                <Body>
                  {`You ran ${count(item.thisMonth)} cases this month. Starting ${date}, Free includes ${count(item.limit)} cases a month.`}
                </Body>
              </Item>
            ),
          )}
        </DialogRows>
      )}
    </SettingsDialogShell>
  );
}

function RestoreDialog({
  billing,
  onClose,
}: {
  billing: Billing;
  onClose: () => void;
}) {
  const actions = useBillingActions();
  const organizationId = useOrganizationId();
  const org =
    useOrganizations().find((o) => o.id === organizationId)?.name ??
    "your organization";
  const people = billing.switched?.people ?? 0;
  const at = billing.switched?.at;
  return (
    <SettingsDialogShell
      description={`Your paused agents have resumed. ${count(people)} ${people === 1 ? "person" : "people"} moved to viewer when ${org} switched to Free${at ? ` on ${longDate(at)}` : ""}.`}
      footer={
        <>
          <Button onClick={onClose} type="button" variant="secondary">
            Dismiss
          </Button>
          <LoadingButton
            onAction={async () => {
              await actions.restoreRoles();
              await actions.refresh();
              setTimeout(onClose, 1_200);
            }}
            pendingLabel="Restoring…"
            successLabel={`Restored ${count(people)} roles.`}
          >
            Restore previous roles
          </LoadingButton>
        </>
      }
      onOpenChange={(open) => (open ? null : onClose())}
      open
      title="Restore previous roles?"
    />
  );
}

export function BillingDialogs({
  billing,
  dialog,
  endsOn,
  onChange,
}: {
  billing: Billing;
  dialog: BillingDialog;
  endsOn: string;
  onChange: (dialog: BillingDialog) => void;
}) {
  const close = () => onChange(null);
  switch (dialog?.kind) {
    case "plan":
      return (
        <PlanDialog
          billing={billing}
          onClose={close}
          onSwitchToFree={() => onChange({ kind: "cancel", from: "plan" })}
          onUpgrade={() => onChange({ kind: "upgrade" })}
        />
      );
    case "upgrade":
      return (
        <UpgradeDialog
          billing={billing}
          onBack={() => onChange({ kind: "plan" })}
          onClose={close}
        />
      );
    case "topup":
      return <TopUpDialog billing={billing} onClose={close} />;
    case "cancel":
      return (
        <CancelFlow
          fallbackDate={endsOn}
          from={dialog.from}
          onBack={() => onChange({ kind: "plan" })}
          onClose={close}
        />
      );
    case "restore":
      return <RestoreDialog billing={billing} onClose={close} />;
    default:
      return null;
  }
}
