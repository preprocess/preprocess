"use client";

// Settings building blocks on Fluid Functionalism. The panels are ports of
// the WorkOS widgets (@workos-inc/widgets); these parts carry the widgets'
// layout (card lists, status, icon panels, empty states, error states) on
// Fluid surfaces: each list is an elevated card with the container radius,
// rows divided inside it, body-role labels with caption-role descriptions,
// and the control on the trailing edge.

import {
  Avatar,
  AvatarFallback,
  avatarMarbleSeed,
} from "@preprocess/ui/components/avatar";
import { Badge } from "@preprocess/ui/components/badge";
import {
  Banner,
  BannerDescription,
  BannerTitle,
} from "@preprocess/ui/components/banner";
import { Button } from "@preprocess/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@preprocess/ui/components/dialog";
import {
  DropdownContent,
  DropdownMenu,
  DropdownTrigger,
} from "@preprocess/ui/components/dropdown";
import {
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { MenuItem } from "@preprocess/ui/components/menu-item";
import { Elevated } from "@preprocess/ui/lib/elevated";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import type { IconComponent } from "@preprocess/ui/lib/icon-context";
import {
  ImageIcon,
  InfoIcon,
  MoreHorizontalIcon,
  SearchIcon,
  User,
  XIcon,
} from "@preprocess/ui/lib/icons";
import { useShape } from "@preprocess/ui/lib/shape-context";
import { useSize } from "@preprocess/ui/lib/size-context";
import { cn } from "@preprocess/ui/lib/utils";
import {
  cloneElement,
  createContext,
  useContext,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type ComponentProps,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { CouldntLoadArt, NoAccessArt } from "../../components/empty-art";
import { ApiError } from "../auth/client";

/**
 * A block of settings: heading, optional description and actions. Leave the
 * title off when the page or tab above already names the block.
 */
export function SettingsSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const header = title || description || actions;
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {header ? (
        <div
          className={cn(
            "flex justify-between gap-4",
            title ? "items-end" : "items-center",
          )}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? (
              <h2
                className="text-subtitle text-foreground"
                style={{ fontVariationSettings: fontWeights.semibold }}
              >
                {title}
              </h2>
            ) : null}
            {description ? (
              title ? (
                <p className="text-caption text-muted-foreground">
                  {description}
                </p>
              ) : (
                // Untitled, the description introduces the tab's content.
                <p className="flex items-start gap-1.5 text-caption text-muted-foreground">
                  <InfoIcon
                    aria-hidden="true"
                    className="mt-px size-3.5 shrink-0"
                  />
                  <span>{description}</span>
                </p>
              )
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * An elevated card on the shape's container radius. `table` lets a Fluid
 * table run edge to edge (the card's corners clip its square row highlight)
 * and pads the outer columns onto the rows' text axis.
 */
export function SettingsCard({
  children,
  className,
  table = false,
}: {
  children: ReactNode;
  className?: string;
  table?: boolean;
}) {
  const shape = useShape();
  return (
    <Elevated
      className={cn(
        "overflow-hidden",
        shape.container,
        table &&
          "[&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5",
        className,
      )}
      offset={1}
    >
      <InCardContext.Provider value={true}>{children}</InCardContext.Provider>
    </Elevated>
  );
}

// True inside a card, so parts that can stand alone (the empty state) don't
// draw a second card.
const InCardContext = createContext(false);

/** A card of rows, divided between them. */
export function SettingsRows({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <SettingsCard
      className={cn("flex flex-col divide-y divide-border/60", className)}
    >
      {children}
    </SettingsCard>
  );
}

/**
 * A search box with the command menu's field: icon that wakes on focus, the
 * subtitle-step text, no field chrome of its own. It sits on a tinted surface
 * (never an outline) that lifts to the card surface while focused. Clicking
 * anywhere on it focuses the input; Escape and the clear button empty it.
 */
export function SettingsSearchField({
  value,
  onChange,
  label,
  placeholder = "Search",
  name,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  name?: string;
  className?: string;
}) {
  const shape = useShape();
  const sizes = useSize();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={cn(
        "group/search flex w-full cursor-text items-center gap-2 px-2.5 transition-colors duration-80",
        sizes.control,
        "bg-hover hover:bg-active focus-within:bg-card focus-within:hover:bg-card",
        shape.input,
        className,
      )}
      onMouseDown={(event) => {
        if (event.target === inputRef.current) return;
        if ((event.target as HTMLElement).closest("button")) return;
        event.preventDefault();
        inputRef.current?.focus();
      }}
    >
      <SearchIcon
        aria-hidden="true"
        className="shrink-0 text-muted-foreground transition-colors duration-80 group-focus-within/search:text-foreground"
        size={sizes.icon}
      />
      <input
        aria-label={label}
        autoComplete="off"
        autoCorrect="off"
        // rounded-none: the base :focus-visible rule hands focused elements
        // the shape radius, and a text input clips its caret to its corners.
        className={cn(
          "min-w-0 flex-1 rounded-none bg-transparent font-[inherit] text-foreground outline-none placeholder:text-muted-foreground",
          sizes.field,
        )}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        ref={inputRef}
        spellCheck={false}
        type="text"
        value={value}
      />
      {value ? (
        <button
          aria-label="Clear search"
          className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:outline-1 focus-visible:outline-(--focus-ring)"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          type="button"
        >
          <XIcon size={14} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * A plain text field on the same tinted surface and size step as the
 * search field and Select, for a value inside a settings row.
 */
export function SettingsTextField({
  className,
  ...props
}: Omit<ComponentProps<"input">, "size">) {
  const shape = useShape();
  const sizes = useSize();
  return (
    <input
      autoComplete="off"
      className={cn(
        "min-w-0 bg-hover px-2.5 text-foreground outline-none transition-colors duration-80 placeholder:text-muted-foreground hover:bg-active focus:bg-card focus:hover:bg-card disabled:pointer-events-none disabled:opacity-50 aria-invalid:outline-1 aria-invalid:outline-destructive",
        sizes.control,
        sizes.field,
        shape.input,
        className,
      )}
      spellCheck={false}
      type="text"
      {...props}
    />
  );
}

/**
 * One row in a card. Two layouts:
 * - a setting (pass `value`): the setting's name and hint in a fixed left
 *   column, its current value (text, avatar, logo, copy field) in the next
 *   column, and actions on the trailing edge;
 * - an item (no `value`): an optional leading mark (provider, device), the
 *   item's name and detail, and actions on the trailing edge.
 */
export function SettingsRow({
  label,
  description,
  value,
  leading,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const heading = (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="min-w-0 truncate text-body text-foreground">{label}</div>
      {description ? (
        <div className="min-w-0 text-caption text-muted-foreground">
          {description}
        </div>
      ) : null}
    </div>
  );
  const actions = children ? (
    <div className="flex shrink-0 items-center justify-end gap-2">
      {children}
    </div>
  ) : null;

  if (value !== undefined) {
    return (
      <div
        className={cn(
          "grid min-h-16 grid-cols-1 items-center gap-x-6 gap-y-2 px-5 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]",
          className,
        )}
      >
        {heading}
        <div className="flex min-w-0 items-center text-body text-foreground">
          {value}
        </div>
        {actions ?? <span aria-hidden="true" />}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-16 items-center justify-between gap-6 px-5 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        {heading}
      </div>
      {actions}
    </div>
  );
}

export type SettingsStatusState =
  "success" | "waiting" | "warning" | "error" | "neutral";

const STATUS_COLOR = {
  success: "green",
  waiting: "gray",
  warning: "amber",
  error: "red",
  neutral: "gray",
} as const;

/** The widgets' Status, as a Fluid dot badge. */
export function SettingsStatus({
  state,
  children,
}: {
  state: SettingsStatusState;
  children: ReactNode;
}) {
  return (
    <Badge color={STATUS_COLOR[state]} data-state={state}>
      {children}
    </Badge>
  );
}

/** A 32px tile for a provider logo or icon at a row's leading edge. */
export function SettingsIconTile({
  children,
  icon: Icon,
}: {
  children?: ReactNode;
  icon?: IconComponent;
}) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
      {Icon ? <Icon size={16} /> : children}
    </div>
  );
}

/** A person's photo, else their marble; a muted person glyph without a user. */
export function SettingsAvatar({
  userId,
  pictureUrl,
}: {
  userId: string | null;
  pictureUrl?: string | null;
}) {
  if (pictureUrl) {
    return (
      <img
        alt=""
        className="size-8 shrink-0 rounded-full object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        src={pictureUrl}
      />
    );
  }
  if (userId) {
    return (
      <Avatar aria-hidden="true">
        <AvatarFallback name={avatarMarbleSeed({ id: userId })} />
      </Avatar>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-hover text-muted-foreground"
    >
      <User className="size-4" />
    </span>
  );
}

const EmptyArtScopeContext = createContext<{
  first: HTMLElement | null;
  register: (element: HTMLElement) => () => void;
} | null>(null);

/**
 * One illustration per page: inside this scope only the first SettingsEmpty
 * with art, in document order, draws it; the rest keep their text.
 */
export function SettingsEmptyArtScope({ children }: { children: ReactNode }) {
  const [members, setMembers] = useState<readonly HTMLElement[]>([]);
  const register = useCallback((element: HTMLElement) => {
    setMembers((current) => [...current, element]);
    return () =>
      setMembers((current) => current.filter((item) => item !== element));
  }, []);
  const first = members.reduce<HTMLElement | null>(
    (earliest, element) =>
      earliest === null ||
      earliest.compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_PRECEDING
        ? element
        : earliest,
    null,
  );
  const value = useMemo(() => ({ first, register }), [first, register]);
  return (
    <EmptyArtScopeContext.Provider value={value}>
      {children}
    </EmptyArtScopeContext.Provider>
  );
}

/** The widgets' EmptyState: optional art, heading, message, optional action. */
export function SettingsEmpty({
  art,
  title,
  description,
  action,
}: {
  art?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const inCard = useContext(InCardContext);
  const artScope = useContext(EmptyArtScopeContext);
  const ref = useRef<HTMLDivElement>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!art || !artScope || !ref.current) return;
    setElement(ref.current);
    return artScope.register(ref.current);
  }, [art, artScope]);
  const showArt =
    art && (!artScope || artScope.first === null || artScope.first === element);
  const content = (
    <div
      className={cn(
        "flex flex-col items-center gap-4 px-6 text-center",
        showArt ? "py-10" : "py-6",
      )}
      ref={ref}
    >
      <div className="flex max-w-sm flex-col items-center gap-1">
        {showArt ? <div className="mb-2 flex">{art}</div> : null}
        <p
          className="text-body text-foreground"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {title}
        </p>
        <p className="text-body text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
  return inCard ? content : <SettingsCard>{content}</SettingsCard>;
}

function errorKind(error: unknown): keyof typeof ERROR_COPY {
  if (error instanceof TypeError) return "network";
  if (!(error instanceof ApiError)) return "generic";
  if (error.status === 401) return "unauthorized";
  if (error.status === 403) return "forbidden";
  return "generic";
}

// Copy per failure kind, for a section that failed to load.
const LOAD_ERROR_COPY = {
  forbidden: {
    title: "You don't have access",
    body: "Ask an organization Owner or Admin if you need access to this section.",
  },
  unauthorized: {
    title: "Session expired",
    body: "Sign in again to view this section.",
  },
  network: {
    title: "Couldn't load this section",
    body: "Something went wrong fetching this data. Try again.",
  },
  generic: {
    title: "Couldn't load this section",
    body: "Something went wrong fetching this data. Try again.",
  },
} as const;

// Copy per failure kind, for an action that failed inline.
const ERROR_COPY = {
  forbidden: {
    title: "Incorrect permissions",
    body: "You don’t have permission to view this. Ask an admin for access.",
  },
  unauthorized: {
    title: "Authorization error",
    body: "Sign in again to continue.",
  },
  network: {
    title: "Couldn’t reach Preprocess",
    body: "Check your connection and try again.",
  },
  generic: {
    title: "Something went wrong",
    body: "Try again, or reload the page.",
  },
} as const;

/**
 * A failure, explained by kind: a section that failed to load shows the
 * empty state with art; `inline` keeps an action's failure as a banner.
 */
export function SettingsError({
  error,
  className,
  inline = false,
}: {
  error: unknown;
  className?: string;
  inline?: boolean;
}) {
  const kind = errorKind(error);
  if (!inline) {
    const copy = LOAD_ERROR_COPY[kind];
    return (
      <SettingsEmpty
        action={
          kind === "unauthorized" ? (
            <Button asChild size="sm" variant="secondary">
              <a href="/sign-in">Sign in</a>
            </Button>
          ) : kind === "forbidden" ? undefined : (
            <Button
              onClick={() => window.location.reload()}
              size="sm"
              variant="secondary"
            >
              Try again
            </Button>
          )
        }
        art={kind === "forbidden" ? <NoAccessArt /> : <CouldntLoadArt />}
        description={copy.body}
        title={copy.title}
      />
    );
  }
  const copy = ERROR_COPY[kind];
  const message =
    kind === "generic" && error instanceof Error && error.message
      ? error.message
      : copy.body;
  return (
    <Banner className={className} data-error-kind={kind} status="error">
      <BannerTitle>{copy.title}</BannerTitle>
      <BannerDescription>{message}</BannerDescription>
    </Banner>
  );
}

// ── Loading: skeletons and reveal ───────────────────────
// Skeletons mirror the real layout: lines sit in the same line box as the
// text they stand in for, buttons take the control height, and rows are the
// real SettingsRow. SettingsReveal swaps them for the content with the
// "Skeleton loader and reveal" cross-fade (see globals.css).

const LINE = {
  body: { box: "h-5", bar: "h-2.5" },
  caption: { box: "h-4", bar: "h-2" },
  subtitle: { box: "h-5", bar: "h-3" },
} as const;

/** A text line placeholder, in the line box of the text it stands in for. */
export function SkeletonLine({
  width,
  role = "body",
}: {
  width: number | string;
  role?: keyof typeof LINE;
}) {
  return (
    <span className={cn("flex items-center", LINE[role].box)}>
      <span
        className={cn("block rounded-full bg-active", LINE[role].bar)}
        data-slot="skeleton"
        style={{ width }}
      />
    </span>
  );
}

/** A button placeholder at the control height. */
export function SkeletonButton({ width = 64 }: { width?: number }) {
  const sizes = useSize();
  const shape = useShape();
  return (
    <span
      className={cn("block bg-active", sizes.control, shape.button)}
      data-slot="skeleton"
      style={{ width }}
    />
  );
}

/** A field placeholder (search box, select) at the control height. */
export function SkeletonField({
  width,
  className,
}: {
  width?: number;
  className?: string;
}) {
  const sizes = useSize();
  const shape = useShape();
  return (
    <span
      className={cn("block bg-active", sizes.control, shape.input, className)}
      data-slot="skeleton"
      style={width ? { width } : undefined}
    />
  );
}

/** A round placeholder (avatar). */
export function SkeletonCircle({ size = 32 }: { size?: number }) {
  return (
    <span
      className="block shrink-0 rounded-full bg-active"
      data-slot="skeleton"
      style={{ width: size, height: size }}
    />
  );
}

/** The 32px icon tile placeholder. */
export function SkeletonTile() {
  return (
    <span
      className="block size-8 shrink-0 rounded-lg bg-active"
      data-slot="skeleton"
    />
  );
}

/**
 * A SettingsRow in its loading shape. Skeletons stand in only for loaded
 * data: pass the row's static label, description and actions as themselves
 * (strings / elements) and a number (width in px) for the parts that come
 * from the API. `value` switches to the setting layout, `leading` to the
 * item layout.
 */
export function SettingsRowSkeleton({
  label,
  description,
  value,
  leading,
  action,
}: {
  label: number | ReactNode;
  description?: number | ReactNode;
  value?: number | ReactNode;
  leading?: ReactNode;
  action?: number | ReactNode;
}) {
  return (
    <SettingsRow
      description={
        typeof description === "number" ? (
          <SkeletonLine role="caption" width={description} />
        ) : (
          description
        )
      }
      label={typeof label === "number" ? <SkeletonLine width={label} /> : label}
      leading={leading}
      value={typeof value === "number" ? <SkeletonLine width={value} /> : value}
    >
      {typeof action === "number" ? <SkeletonButton width={action} /> : action}
    </SettingsRow>
  );
}

/** Placeholder item rows: a tile, a name and a detail line. */
export function SettingsSkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <SettingsRows>
      {Array.from({ length: count }, (_, index) => (
        <SettingsRowSkeleton
          description={96}
          key={index}
          label={160}
          leading={<SkeletonTile />}
        />
      ))}
    </SettingsRows>
  );
}

/**
 * Shows `skeleton` until `data` arrives, then cross-fades to the content in
 * the same grid cell, so the swap moves nothing. The content keeps one
 * element throughout (no remount when the skeleton leaves). Data that is
 * there on first render (cached) shows at once, without the transition.
 */
export function SettingsReveal<T>({
  data,
  skeleton,
  children,
  className,
}: {
  data: T | undefined;
  skeleton: ReactNode;
  children: (data: T) => ReactNode;
  className?: string;
}) {
  const ready = data !== undefined;
  const [revealed, setRevealed] = useState(ready);
  const [skeletonGone, setSkeletonGone] = useState(ready);

  useEffect(() => {
    if (!ready || revealed) return;
    // Paint the content at opacity 0 first, then flip to revealed.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setRevealed(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [ready, revealed]);

  useEffect(() => {
    if (!revealed || skeletonGone) return;
    const id = window.setTimeout(() => setSkeletonGone(true), 450);
    return () => window.clearTimeout(id);
  }, [revealed, skeletonGone]);

  return (
    <div
      aria-busy={!ready || undefined}
      className={cn("t-skel", revealed && "is-revealed", className)}
    >
      {skeletonGone ? null : (
        <div aria-hidden="true" className="t-skel-skeleton">
          {skeleton}
        </div>
      )}
      {data !== undefined ? (
        <div className="t-skel-content" key="content">
          {children(data)}
        </div>
      ) : null}
    </div>
  );
}

export type SettingsMenuAction = {
  label: string;
  icon?: IconComponent;
  onSelect: () => void;
  disabled?: boolean;
};

/** The trailing ⋯ menu on a row. */
export function SettingsRowMenu({
  label,
  actions,
}: {
  label: string;
  actions: readonly SettingsMenuAction[];
}) {
  return (
    <DropdownMenu>
      <DropdownTrigger
        render={
          <Button aria-label={label} size="icon-compact" variant="ghost">
            <MoreHorizontalIcon />
          </Button>
        }
      />
      <DropdownContent align="end">
        {actions.map((action, index) => (
          <MenuItem
            disabled={action.disabled}
            icon={action.icon}
            index={index}
            key={action.label}
            label={action.label}
            onSelect={action.onSelect}
          />
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}

/** Dialog shell: title, description, body, and an optional footer. */
export function SettingsDialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "sm",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "lg";
}) {
  // Focus lands on the panel itself, so a radio or checkbox group in the
  // body doesn't open with its first row lit.
  const panel = useRef<HTMLDivElement>(null);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent initialFocus={panel} ref={panel} size={size}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {children}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A yes/no dialog for one action. The confirm button runs `onConfirm`, shows
 * its progress, and closes the dialog when it succeeds; a failure stays open
 * with the error.
 */
export function SettingsConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel = "Working…",
  successLabel = "Done",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  successLabel?: string;
  onConfirm: () => Promise<unknown>;
}) {
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <SettingsDialogShell
      description={description}
      footer={
        <>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <LoadingButton
            onAction={async () => {
              setError(null);
              await onConfirm();
            }}
            onError={setError}
            onStatusChange={(status) => {
              if (status === "success") {
                window.setTimeout(() => onOpenChange(false), 600);
              }
            }}
            pendingLabel={pendingLabel}
            successLabel={successLabel}
          >
            {confirmLabel}
          </LoadingButton>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    >
      {error ? <SettingsError error={error} inline /> : null}
    </SettingsDialogShell>
  );
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "3 days ago", "in 2 hours", "just now". */
export function formatRelative(value: string | Date, now = Date.now()) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) {
      return relativeTime.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
}

/** "Oct 24, 2026". */
export function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Dialog helpers for forms: a trigger-wrapping dialog, its cancel + action
// footer, a confirm body, and the inline message line.

export function SettingsPanelMessage({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "danger";
}) {
  return (
    <p
      className={
        tone === "danger"
          ? "text-body text-destructive"
          : "text-body text-muted-foreground"
      }
      role={tone === "danger" ? "alert" : undefined}
    >
      {children}
    </p>
  );
}

export function actionErrorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export function SettingsDialogActions({
  cancelLabel = "Cancel",
  children,
  onCancel,
  pending = false,
}: {
  cancelLabel?: string;
  children: ReactNode;
  onCancel: () => void;
  pending?: boolean;
}) {
  return (
    <DialogFooter className="[&>div]:w-auto [&>div]:shrink-0 [&_[data-slot=loading-button]]:w-auto">
      <Button
        disabled={pending}
        onClick={onCancel}
        type="button"
        variant="secondary"
      >
        {cancelLabel}
      </Button>
      {children}
    </DialogFooter>
  );
}

export function SettingsConfirmBody({
  actionLabel,
  onCancel,
  onConfirm,
  pendingLabel = "Working…",
  successLabel = "Done",
}: {
  actionLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  pendingLabel?: string;
  successLabel?: string;
}) {
  const actionRef = useRef<LoadingButtonHandle>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
      ) : null}
      <SettingsDialogActions onCancel={onCancel} pending={pending}>
        <LoadingButton
          ref={actionRef}
          className="w-auto"
          onAction={async () => {
            setError(null);
            try {
              await onConfirm();
            } catch (cause) {
              setError(actionErrorMessage(cause, "Something went wrong."));
              throw cause;
            }
          }}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel={pendingLabel}
          successLabel={successLabel}
        >
          {actionLabel}
        </LoadingButton>
      </SettingsDialogActions>
    </div>
  );
}

export function SettingsDialog({
  children,
  container,
  content,
  description,
  modal,
  onOpenChange,
  open: openProp,
  title,
}: {
  children?: ReactNode;
  container?: HTMLElement | null;
  content: (close: () => void) => ReactNode;
  description?: string;
  modal?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  title: string;
}) {
  const controlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlled ? openProp : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (typeof next !== "boolean") return;
      if (!controlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const trigger =
    children == null ? null : isValidElement(children) ? (
      cloneElement(
        children as ReactElement<{
          onClick?: (event: MouseEvent<HTMLElement>) => void;
        }>,
        {
          onClick: (event: MouseEvent<HTMLElement>) => {
            (
              children.props as {
                onClick?: (event: MouseEvent<HTMLElement>) => void;
              }
            ).onClick?.(event);
            handleOpenChange(true);
          },
        },
      )
    ) : (
      <Button
        onClick={() => handleOpenChange(true)}
        size="sm"
        type="button"
        variant="secondary"
      >
        {children}
      </Button>
    );

  return (
    <Dialog
      modal={modal}
      onOpenChange={(next) => {
        if (!next) handleOpenChange(false);
      }}
      open={open}
    >
      {trigger}
      <DialogContent container={container} size="sm">
        <div className="mb-4 flex flex-col gap-1.5">
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </div>
        {open ? content(() => handleOpenChange(false)) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Replays the shared error shake (transitions.dev "Error state shake", see
 * globals.css) on the element holding the returned ref whenever `trigger`
 * changes to a new truthy value. Pass a fresh value per failed attempt (a
 * timestamp) so the same message still shakes again. The element needs the
 * `t-input` class.
 */
export function useErrorShake<T extends HTMLElement>(trigger: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!trigger || !element) return;
    element.classList.remove("is-shaking");
    void element.offsetWidth;
    element.classList.add("is-shaking");
  }, [trigger]);
  return ref;
}

function endShake(event: AnimationEvent<HTMLElement>) {
  if (event.animationName === "t-input-shake") {
    event.currentTarget.classList.remove("is-shaking");
  }
}

/**
 * A 40px preview of a chosen image file. The drop zone takes images only, so
 * an object URL is enough (FileThumbnail would pull PDF.js into the app).
 */
function ImagePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-active">
      {url ? (
        <img alt="" className="size-full object-contain" src={url} />
      ) : null}
    </span>
  );
}

/** A failed attempt: the message, and when (so each attempt shakes). */
export type SettingsAttemptError = { message: string; at: number };

/**
 * A file drop zone: a tinted surface (never an outline alone) that deepens
 * and rings while a file is dragged over it. Click or Enter/Space opens the
 * picker. A chosen file shows its thumbnail, name, and a remove button.
 * Files that don't match `accept` are ignored. An `error` tints the zone
 * red, shows the message under it, and shakes it once per failed attempt.
 */
export function SettingsFileDrop({
  accept,
  file,
  onFileChange,
  label,
  hint,
  error,
}: {
  /** MIME types, e.g. ["image/png", "image/svg+xml"]. */
  accept: readonly string[];
  file: File | null;
  onFileChange: (file: File | null) => void;
  label: string;
  hint?: string;
  error?: SettingsAttemptError | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const shape = useShape();
  const shakeRef = useErrorShake<HTMLDivElement>(error?.at);

  const take = (candidate: File | undefined) => {
    if (candidate && accept.includes(candidate.type)) onFileChange(candidate);
  };

  const input = (
    <input
      accept={accept.join(",")}
      className="sr-only"
      onChange={(event) => {
        take(event.target.files?.[0]);
        event.target.value = "";
      }}
      ref={inputRef}
      tabIndex={-1}
      type="file"
    />
  );

  const surface = error
    ? "bg-destructive-light/60 ring-1 ring-destructive/50"
    : dragging
      ? "bg-active ring-1 ring-border"
      : file
        ? "bg-hover"
        : "bg-hover hover:bg-active";

  const zone = file ? (
    <div
      className={cn(
        "t-input flex items-center gap-3 p-3 transition-[background-color,box-shadow] duration-80",
        shape.container,
        surface,
      )}
      onAnimationEnd={endShake}
      ref={shakeRef}
    >
      <ImagePreview file={file} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body text-foreground">{file.name}</span>
        <span className="text-caption text-muted-foreground">
          {Math.max(1, Math.round(file.size / 1024))} KB
        </span>
      </div>
      <Button
        onClick={() => inputRef.current?.click()}
        type="button"
        variant="ghost"
      >
        Replace
      </Button>
      <Button
        aria-label="Remove file"
        onClick={() => onFileChange(null)}
        size="icon-compact"
        type="button"
        variant="ghost"
      >
        <XIcon />
      </Button>
      {input}
    </div>
  ) : (
    <div
      aria-label={label}
      className={cn(
        "t-input flex cursor-pointer flex-col items-center gap-2 px-6 py-8 text-center transition-[background-color,box-shadow] duration-80 outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring)",
        shape.container,
        surface,
      )}
      onAnimationEnd={endShake}
      onClick={() => inputRef.current?.click()}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragging(false);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        take(event.dataTransfer.files[0]);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      ref={shakeRef}
      role="button"
      tabIndex={0}
    >
      <ImageIcon className="text-muted-foreground" size={20} />
      <span className="text-body text-foreground">
        {dragging ? "Drop to upload" : "Drop a file here, or click to browse"}
      </span>
      {hint ? (
        <span className="text-caption text-muted-foreground">{hint}</span>
      ) : null}
      {input}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {zone}
      {error ? (
        <p className="pl-1 text-caption text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
