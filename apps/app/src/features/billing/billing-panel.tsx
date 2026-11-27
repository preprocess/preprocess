"use client";

// Settings → Organization → Billing (Design round 4, PRE-94): the plan,
// prepaid credits, this month's charges, the spending limit and payment.
// Owners only, on our cloud only; the route answers not found otherwise.

import { Badge } from "@preprocess/ui/components/badge";
import {
  Banner,
  BannerAction,
  BannerActions,
  BannerDescription,
  BannerTitle,
} from "@preprocess/ui/components/banner";
import { Button } from "@preprocess/ui/components/button";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { Skeleton } from "@preprocess/ui/components/skeleton";
import { Switch } from "@preprocess/ui/components/switch";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";
import {
  SettingsError,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "../settings/kit";
import { SettingsStacked } from "../settings/settings-widgets";
import {
  useBilling,
  useBillingActions,
  useBillingUsage,
  useIsOwner,
  useSpending,
} from "./billing-api";
import { BillingDialogs, type BillingDialog } from "./billing-dialogs";
import {
  cardLabel,
  count,
  creditsUsd,
  dayName,
  dollarsOf,
  longDate,
  monthDay,
  monthName,
  nextMonthStart,
  PLAN_NAME,
  PLAN_SUMMARY,
  usd,
  wholeDollars,
} from "./billing-format";
import type {
  AutoReload as AutoReloadSettings,
  Billing,
  BillingUsage,
  Spending,
} from "./billing-types";

const medium = { fontVariationSettings: fontWeights.medium };

// Low below the reload threshold, or below $5 with auto-reload off.
const LOW_CREDITS = 500;

export function Bar({ value }: { value: number }) {
  return (
    <div
      aria-hidden="true"
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={
          value >= 1
            ? "h-full rounded-full bg-destructive"
            : "h-full rounded-full bg-foreground"
        }
        style={{ width: `${Math.min(100, Math.max(0, value) * 100)}%` }}
      />
    </div>
  );
}

function Meter({
  label,
  value,
  ratio,
  hint,
}: {
  label: ReactNode;
  value?: ReactNode;
  ratio: number;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-body text-foreground">{label}</span>
        {value ? (
          <span className="text-body tabular-nums text-foreground">
            {value}
          </span>
        ) : null}
      </div>
      <Bar value={ratio} />
      {hint ? (
        <span className="text-caption text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

const Amount = ({ children }: { children: ReactNode }) => (
  <span className="text-body tabular-nums text-foreground">{children}</span>
);

function UsageRow({
  label,
  detail,
  amount,
}: {
  label: string;
  detail?: string;
  amount: string;
}) {
  return (
    <div>
      <SettingsRow
        className="hidden min-h-12 sm:grid"
        label={label}
        value={
          <span className="truncate text-muted-foreground">{detail ?? ""}</span>
        }
      >
        <Amount>{amount}</Amount>
      </SettingsRow>
      <SettingsRow className="sm:hidden" description={detail} label={label}>
        <Amount>{amount}</Amount>
      </SettingsRow>
    </div>
  );
}

function DailyChart({ usage }: { usage: BillingUsage }) {
  const max = Math.max(...usage.daily.map((d) => d.usd), 0);
  const first = usage.daily[0];
  const last = usage.daily.at(-1);
  const total = usd(usage.paidFromCreditsUsd);
  return (
    <div
      aria-label={`Used this month: ${total}`}
      className="flex flex-col gap-3 px-5 py-4"
      role="group"
    >
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-body text-foreground">Used this month</span>
        <span className="text-body tabular-nums text-foreground">{total}</span>
      </div>
      <div aria-hidden="true" className="flex h-20 items-end gap-1">
        {usage.daily.map((d) => (
          <div
            className="flex-1 rounded-sm bg-foreground"
            key={d.day}
            style={{
              height: `${max > 0 ? Math.max(4, (d.usd / max) * 100) : 4}%`,
              opacity: 0.85,
            }}
            title={`${dayName(d.day)}: ${usd(d.usd)}`}
          />
        ))}
      </div>
      {first && last ? (
        <div
          aria-hidden="true"
          className="flex justify-between text-caption text-muted-foreground"
        >
          <span>{dayName(first.day)}</span>
          <span>{dayName(last.day)}</span>
        </div>
      ) : null}
    </div>
  );
}

function AutoReload({
  billing,
  spending,
}: {
  billing: Billing;
  spending: Spending | undefined;
}) {
  const actions = useBillingActions();
  const saved = billing.autoReload;
  const noCard = !billing.started || !billing.card;
  const on = Boolean(saved?.enabled) && !noCard;
  const defaultCap = saved?.monthlyLimitUsd ?? spending?.limitUsd ?? null;
  const [below, setBelow] = useState(
    String(creditsUsd(saved?.belowCredits ?? 2_500)),
  );
  const [add, setAdd] = useState(
    String(creditsUsd(saved?.addCredits ?? 10_000)),
  );
  const [cap, setCap] = useState(defaultCap === null ? "" : String(defaultCap));
  const fields = [
    useRef<ValidatedFieldHandle>(null),
    useRef<ValidatedFieldHandle>(null),
    useRef<ValidatedFieldHandle>(null),
  ];
  const settings = (enabled: boolean): AutoReloadSettings => ({
    enabled,
    belowCredits: dollarsOf(below) * 100,
    addCredits: dollarsOf(add) * 100,
    monthlyLimitUsd: cap.trim() === "" ? null : dollarsOf(cap),
  });
  const summary = noCard
    ? "Add a card to turn on auto-reload."
    : on && saved
      ? `When balance falls below ${usd(creditsUsd(saved.belowCredits))}, add ${usd(creditsUsd(saved.addCredits))}${saved.monthlyLimitUsd === null ? "" : `, up to ${usd(saved.monthlyLimitUsd)} a month`}.`
      : "Off. Cases halt if your balance reaches $0.";
  const failed = on ? saved?.failed : null;
  const capUntil =
    on && saved?.monthlyLimitUsd != null ? saved.capReachedUntil : null;

  const retry = async () => {
    const purchase = await actions.retryAutoReload();
    if (purchase.url && purchase.action === "card_declined")
      throw new Error("declined");
    if (purchase.url) window.location.assign(purchase.url);
  };

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-body text-foreground">Auto-reload</span>
          <span className="text-caption text-muted-foreground">{summary}</span>
          {capUntil && saved?.monthlyLimitUsd != null ? (
            <span className="text-caption text-foreground">
              {`Monthly cap of ${usd(saved.monthlyLimitUsd)} reached. Auto-reload resumes on ${monthDay(capUntil)} (UTC).`}
            </span>
          ) : null}
        </div>
        <Switch
          checked={on}
          disabled={noCard}
          label={on ? "On" : "Off"}
          onToggle={() =>
            void actions.saveAutoReload({
              ...(saved ?? settings(false)),
              enabled: !on,
            })
          }
        />
      </div>
      {failed ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-caption text-destructive">
            {failed.reason === "card_declined"
              ? "Last reload failed: your card was declined."
              : "Last reload failed."}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <LoadingButton onAction={retry} size="compact" variant="secondary">
              Retry
            </LoadingButton>
            <Button
              onClick={() => void actions.openPortal()}
              size="compact"
              type="button"
            >
              Update card
            </Button>
          </div>
        </div>
      ) : null}
      {on ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ValidatedField
              id="reload-below"
              inputMode="numeric"
              label="When balance falls below"
              onChange={setBelow}
              onBlur={() => fields[0].current?.commit()}
              ref={fields[0]}
              validate={wholeDollars(5, null, "Minimum threshold is $5.")}
              value={below}
            />
            <ValidatedField
              id="reload-add"
              inputMode="numeric"
              label="Add"
              onChange={setAdd}
              onBlur={() => fields[1].current?.commit()}
              ref={fields[1]}
              validate={(v) =>
                wholeDollars(
                  10,
                  5_000,
                  "Minimum reload amount is $10.",
                  "Maximum reload amount is $5,000.",
                )(v) ??
                (dollarsOf(v) <= dollarsOf(below)
                  ? "Reload amount must be greater than the threshold."
                  : null)
              }
              value={add}
            />
            <ValidatedField
              hint="Defaults to your spending limit."
              id="reload-cap"
              inputMode="numeric"
              label="Monthly cap"
              onChange={setCap}
              onBlur={() => fields[2].current?.commit()}
              ref={fields[2]}
              validate={(v) =>
                v.trim() === ""
                  ? null
                  : (wholeDollars(1, null, "Enter a whole-dollar amount.")(v) ??
                    (dollarsOf(v) < dollarsOf(add)
                      ? "Monthly cap must be at least the reload amount."
                      : null))
              }
              value={cap}
            />
          </div>
          <div className="flex justify-end">
            <div className="shrink-0">
              <LoadingButton
                onAction={async () => {
                  const valid = fields
                    .map((f) => f.current?.commit() ?? true)
                    .every(Boolean);
                  if (!valid) throw new Error("invalid");
                  await actions.saveAutoReload(settings(true));
                }}
                pendingLabel="Saving…"
                successLabel="Saved"
                variant="secondary"
              >
                Save
              </LoadingButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LoadingPanel() {
  return (
    <SettingsStacked>
      {(
        [
          ["Plan", 2],
          ["Credits", 3],
          ["This month", 6],
        ] as const
      ).map(([title, rows]) => (
        <SettingsSection key={title} title={title}>
          <SettingsRows>
            {Array.from({ length: rows }, (_, j) => (
              <div
                className="flex min-h-12 items-center justify-between gap-6 px-5 py-3"
                key={j}
              >
                <Skeleton className="h-3.5 w-40 rounded-full" />
                <Skeleton className="h-3.5 w-16 rounded-full" />
              </div>
            ))}
          </SettingsRows>
        </SettingsSection>
      ))}
    </SettingsStacked>
  );
}

const EMPTY_BANNER = [
  "Credit balance is empty",
  "New cases won't start and running cases are halted until you add credits. Top up your balance, then use Rerun to restart halted cases.",
] as const;

function usageLines(plan: Billing["plan"], u: BillingUsage) {
  const included = plan === "free";
  const seats = u.seats.count;
  const over = Math.max(0, u.storage.gbMonths - u.storage.includedGbMonths);
  const gb = (value: number) =>
    value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return [
    {
      label: "Active seats",
      detail: included
        ? `${count(seats)} active ${seats === 1 ? "seat" : "seats"}, included`
        : `${count(seats)} active ${seats === 1 ? "seat" : "seats"} × $16`,
      amount: usd(u.seats.usd),
    },
    {
      label: "Cases",
      detail: included
        ? `${count(u.cases.count)} cases, included`
        : `${count(u.cases.count)} cases, ${count(u.cases.includedCount)} free`,
      amount: usd(u.cases.usd),
    },
    { label: "Model usage", amount: usd(u.modelUsageUsd) },
    { label: "decide", amount: usd(u.decideUsd) },
    { label: "OCR", amount: usd(u.ocrUsd) },
    { label: "Sandbox time", amount: usd(u.sandboxUsd) },
    {
      label: "Storage",
      detail:
        over > 0
          ? `${gb(u.storage.gbMonths)} GB-months (${gb(u.storage.includedGbMonths)} included, ${gb(over)} at $0.10)`
          : `${gb(u.storage.gbMonths)} GB-months, included`,
      amount: usd(u.storage.usd),
    },
  ];
}

const invoiceStatus = (status: string, pastDue: boolean) =>
  status === "paid"
    ? { label: "Paid", color: "green" as const }
    : status === "open" && pastDue
      ? { label: "Past due", color: "red" as const }
      : status === "open"
        ? { label: "Due", color: "amber" as const }
        : {
            label: status.charAt(0).toUpperCase() + status.slice(1),
            color: "gray" as const,
          };

export function BillingPanel() {
  const owner = useIsOwner();
  const billing = useBilling();
  const navigate = useNavigate();
  const data = billing.data;
  const loaded = Boolean(data);
  const usage = useBillingUsage(loaded);
  const spending = useSpending(loaded && data?.plan === "team");
  const actions = useBillingActions();
  const [dialog, setDialog] = useState<BillingDialog>(null);
  const restoreOffered = useRef(false);

  useEffect(() => {
    if (restoreOffered.current || !data) return;
    if (data.plan === "team" && data.switched?.people) {
      restoreOffered.current = true;
      setDialog({ kind: "restore" });
    }
  }, [data]);

  if (owner === false || data === null)
    return (
      <SettingsError
        error={
          new Error("This page doesn't exist, or you don't have access to it.")
        }
      />
    );
  if (billing.isError) return <SettingsError error={billing.error} />;
  if (!data || !usage.data || owner === undefined) return <LoadingPanel />;

  const u = usage.data;
  const plan = data.plan;
  const prepaid = plan === "free" || plan === "team";
  const credits = data.credits;
  const balance = credits ? creditsUsd(credits.remaining - credits.owed) : 0;
  const empty = prepaid && credits !== null && balance <= 0;
  const reload = data.autoReload;
  const low =
    prepaid &&
    credits !== null &&
    !empty &&
    credits.remaining < (reload?.enabled ? reload.belowCredits : LOW_CREDITS);
  const limit = spending.data;
  const limitReached = plan === "team" && Boolean(limit?.reached);
  const ending = plan === "team" && data.change?.plan === "free";
  const endsOn = data.change?.at ? longDate(data.change.at) : null;
  const noCard = !data.started;

  const openTopUp = () => setDialog({ kind: "topup" });
  const openChanges = () => setDialog({ kind: "cancel", from: "page" });

  const banner: ReactNode = noCard ? (
    <Banner contrast="high" status="warning">
      <BannerTitle>Add a payment method to start running cases</BannerTitle>
      <BannerDescription>
        Your organization needs a card on file before agents can run, including
        on the Free plan.
      </BannerDescription>
      <BannerActions>
        <BannerAction onClick={() => void actions.addCard()}>
          Add a card
        </BannerAction>
      </BannerActions>
    </Banner>
  ) : data.pastDue ? (
    <Banner contrast="high" status="error">
      <BannerTitle>Last payment failed</BannerTitle>
      <BannerDescription>
        Update your card so your account stays current.
      </BannerDescription>
      <BannerActions>
        <BannerAction onClick={() => void actions.openPortal()}>
          Update card
        </BannerAction>
      </BannerActions>
    </Banner>
  ) : limitReached ? (
    <Banner contrast="high" status="error">
      <BannerTitle>Monthly spending limit reached</BannerTitle>
      <BannerDescription>
        New cases won't start and running cases are halted until the limit
        resets on the 1st (UTC). Raise the limit and use Rerun to restart halted
        cases.
      </BannerDescription>
      <BannerActions>
        <BannerAction
          onClick={() =>
            void navigate({
              to: "/settings/organization/guardrails",
              hash: "spending",
            })
          }
        >
          Change limit
        </BannerAction>
      </BannerActions>
    </Banner>
  ) : empty ? (
    <Banner contrast="high" status="error">
      <BannerTitle>{EMPTY_BANNER[0]}</BannerTitle>
      <BannerDescription>{EMPTY_BANNER[1]}</BannerDescription>
      <BannerActions>
        <BannerAction onClick={openTopUp}>Top up</BannerAction>
      </BannerActions>
    </Banner>
  ) : ending && endsOn ? (
    <Banner contrast="high" status="warning">
      <BannerTitle>{`Team ends on ${endsOn}`}</BannerTitle>
      <BannerDescription>
        {`Your organization moves to Free on ${endsOn}. Review seat selections and changes in Billing, or keep Team to cancel the switch.`}
      </BannerDescription>
      <BannerActions>
        <BannerAction onClick={openChanges}>Review changes</BannerAction>
        <BannerAction onClick={() => void actions.keepTeam()}>
          Keep Team
        </BannerAction>
      </BannerActions>
    </Banner>
  ) : null;

  const total =
    Math.round((u.paidFromCreditsUsd + u.billedAtMonthEndUsd) * 100) / 100;

  return (
    <>
      <SettingsStacked>
        {banner}

        <SettingsSection
          description="Your organization's current plan."
          title="Plan"
        >
          <SettingsRows>
            <SettingsRow
              className="max-sm:flex-col max-sm:items-start max-sm:gap-3"
              description={
                ending && endsOn ? (
                  <span className="flex flex-col gap-0.5">
                    <span className="text-foreground">{`Team ends on ${endsOn}`}</span>
                    <span>
                      Your organization moves to Free then, and your credit
                      balance carries over.
                    </span>
                  </span>
                ) : (
                  PLAN_SUMMARY[plan]
                )
              }
              label={
                <span className="flex items-center gap-2">
                  <span style={medium}>{PLAN_NAME[plan]}</span>
                  <Badge size="compact">Current plan</Badge>
                </span>
              }
            >
              {plan === "team" ? (
                ending ? (
                  <LoadingButton
                    onAction={() => actions.keepTeam()}
                    pendingLabel="Updating…"
                    successLabel="Kept"
                    variant="secondary"
                  >
                    Keep Team
                  </LoadingButton>
                ) : (
                  <Button onClick={openChanges} type="button" variant="ghost">
                    Cancel plan
                  </Button>
                )
              ) : null}
              {plan === "internal" ? null : (
                <Button
                  onClick={() => setDialog({ kind: "plan" })}
                  type="button"
                  variant="secondary"
                >
                  Change plan
                </Button>
              )}
            </SettingsRow>
          </SettingsRows>
          {plan === "free" ? (
            <SettingsRows>
              <Meter
                label="Active seats"
                ratio={u.now.seats / (u.now.seatLimit ?? 3)}
                value={`${count(u.now.seats)} of ${count(u.now.seatLimit ?? 3)}`}
              />
              <Meter
                label="Cases this month"
                ratio={u.now.casesThisMonth / (u.now.caseLimit ?? 1_000)}
                value={`${count(u.now.casesThisMonth)} of ${count(u.now.caseLimit ?? 1_000)}`}
              />
              <Meter
                label="Storage"
                ratio={Math.min(
                  0.999,
                  u.now.storageGb / u.now.storageIncludedGb,
                )}
                value={`${u.now.storageGb.toLocaleString("en-US", { maximumFractionDigits: 1 })} of ${u.now.storageIncludedGb} GB included`}
              />
            </SettingsRows>
          ) : null}
        </SettingsSection>

        {plan !== "enterprise" ? (
          <SettingsSection
            description={
              plan === "free"
                ? "Prepaid balance for model usage, decide, OCR and sandbox time. Credits never expire."
                : "Prepaid balance for cases, model usage, decide, OCR and sandbox time. Credits never expire."
            }
            title="Credits"
          >
            <SettingsRows>
              <SettingsRow
                description={
                  plan === "internal"
                    ? "Internal organizations aren't charged for usage."
                    : balance < 0
                      ? "Deducted from your next top-up."
                      : plan === "free"
                        ? "Usage draws from this balance, which started with a one-time $5 credit."
                        : "Usage draws from this balance. Seats and storage are billed to your card at month end."
                }
                label="Balance"
              >
                {low ? (
                  <Badge color="amber" size="compact" variant="dot">
                    Low
                  </Badge>
                ) : null}
                <span
                  className="text-title tabular-nums text-foreground"
                  style={medium}
                >
                  {plan === "internal" ? "Unlimited" : usd(balance)}
                </span>
                {plan === "internal" ? null : (
                  <Button
                    onClick={openTopUp}
                    type="button"
                    variant={empty || low ? "primary" : "secondary"}
                  >
                    Top up
                  </Button>
                )}
              </SettingsRow>
              {noCard ? null : <DailyChart usage={u} />}
              {prepaid ? (
                <AutoReload
                  billing={data}
                  key={JSON.stringify(data.autoReload)}
                  spending={limit}
                />
              ) : null}
            </SettingsRows>
          </SettingsSection>
        ) : null}

        <SettingsSection
          description={`${monthName(u.month)} so far (UTC).`}
          title="This month"
        >
          <div className="flex flex-col gap-3">
            <SettingsRows>
              {usageLines(plan, u).map((line) => (
                <UsageRow key={line.label} {...line} />
              ))}
              {plan === "enterprise" || (noCard && plan === "free") ? null : (
                <UsageRow
                  amount={usd(-u.paidFromCreditsUsd)}
                  detail={
                    plan === "free"
                      ? "Model usage, decide, OCR and sandbox time"
                      : "Cases, model usage, decide, OCR and sandbox time"
                  }
                  label="Paid from credits"
                />
              )}
              <SettingsRow
                className="min-h-14 bg-hover"
                description={
                  plan === "internal"
                    ? "Internal organizations aren't charged for usage."
                    : plan !== "enterprise"
                      ? "Seats and storage"
                      : undefined
                }
                label={
                  <span style={medium}>
                    {plan === "enterprise"
                      ? "Total so far"
                      : "Billed at month end"}
                  </span>
                }
              >
                <span
                  className="text-subtitle tabular-nums text-foreground"
                  style={medium}
                >
                  {usd(plan === "enterprise" ? total : u.billedAtMonthEndUsd)}
                </span>
              </SettingsRow>
            </SettingsRows>
            {plan === "enterprise" && data.commit ? (
              <SettingsRows>
                <Meter
                  hint="Seats and monthly usage draw down your annual commit."
                  label="Annual commit"
                  ratio={data.commit.usedUsd / data.commit.totalUsd}
                  value={`${usd(data.commit.usedUsd).replace(/\.00$/, "")} of ${usd(data.commit.totalUsd).replace(/\.00$/, "")} used this contract year`}
                />
              </SettingsRows>
            ) : null}
            <p className="text-caption text-muted-foreground">
              Amounts are in US dollars. Internally, 1 credit equals $0.01.
            </p>
          </div>
        </SettingsSection>

        {plan === "team" && limit && limit.limitUsd !== null ? (
          <SettingsSection
            actions={
              <Button
                render={
                  <Link
                    hash="spending"
                    to="/settings/organization/guardrails"
                  />
                }
                size="compact"
                variant="ghost"
              >
                Manage in Guardrails
              </Button>
            }
            title="Spending limit"
          >
            <SettingsRows>
              <Meter
                hint="Counts usage only; seats and storage aren't included. New cases stop and running cases halt when usage reaches this limit. Resets on the 1st of each month (UTC)."
                label={`${usd(limit.spentUsd)} of ${usd(limit.limitUsd)} this month`}
                ratio={limit.reached ? 1 : limit.spentUsd / limit.limitUsd}
              />
            </SettingsRows>
          </SettingsSection>
        ) : null}

        {plan === "internal" ? null : (
          <SettingsSection
            description="Card on file, billing email, and invoices."
            title="Payment"
          >
            <div className="flex flex-col gap-3">
              <SettingsRows>
                <SettingsRow
                  className="max-sm:flex-col max-sm:items-start max-sm:gap-3"
                  description={
                    plan === "enterprise"
                      ? "Paid by invoice"
                      : data.card
                        ? `${cardLabel(data.card)} · expires ${String(data.card.expMonth).padStart(2, "0")}/${String(data.card.expYear).slice(-2)}`
                        : "No card on file"
                  }
                  label="Payment method"
                >
                  {plan === "enterprise" ? null : (
                    <Button
                      onClick={() =>
                        void (data.card
                          ? actions.openPortal()
                          : actions.addCard())
                      }
                      type="button"
                      variant={
                        !data.card || data.pastDue ? "primary" : "secondary"
                      }
                    >
                      {data.card ? "Update" : "Add a card"}
                    </Button>
                  )}
                </SettingsRow>
                {data.email ? (
                  <SettingsRow
                    className="max-sm:flex-col max-sm:items-start max-sm:gap-3"
                    description={
                      <span className="break-all">{data.email}</span>
                    }
                    label="Billing email"
                  >
                    <Button
                      onClick={() => void actions.openPortal()}
                      type="button"
                      variant="secondary"
                    >
                      Edit
                    </Button>
                  </SettingsRow>
                ) : null}
              </SettingsRows>
              {noCard || data.invoices.length === 0 ? null : (
                <SettingsRows>
                  <div className="flex min-h-12 items-center justify-between px-5 py-3">
                    <span className="text-body text-foreground">Invoices</span>
                    <Button
                      onClick={() => void actions.openPortal()}
                      size="compact"
                      type="button"
                      variant="ghost"
                    >
                      All invoices
                    </Button>
                  </div>
                  {data.invoices.map((invoice) => {
                    const status = invoiceStatus(invoice.status, data.pastDue);
                    return (
                      <SettingsRow
                        description={
                          <Badge
                            color={status.color}
                            size="compact"
                            variant="dot"
                          >
                            {status.label}
                          </Badge>
                        }
                        key={invoice.id}
                        label={longDate(invoice.at)}
                      >
                        <Amount>{usd(invoice.totalUsd)}</Amount>
                        {invoice.url ? (
                          <Button
                            render={
                              <a
                                href={invoice.url}
                                rel="noreferrer"
                                target="_blank"
                              />
                            }
                            size="compact"
                            variant="ghost"
                          >
                            View invoice
                          </Button>
                        ) : null}
                      </SettingsRow>
                    );
                  })}
                </SettingsRows>
              )}
            </div>
          </SettingsSection>
        )}
      </SettingsStacked>
      <BillingDialogs
        billing={data}
        dialog={dialog}
        endsOn={endsOn ?? nextMonthStart(u.month)}
        onChange={setDialog}
      />
    </>
  );
}
