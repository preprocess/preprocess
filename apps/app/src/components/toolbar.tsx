import {
  HoverScope,
  useHoverScopeItem,
} from "@preprocess/ui/components/hover-scope";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { useShape } from "@preprocess/ui/lib/shape-context";
import { spring } from "@preprocess/ui/lib/springs";
import { cn } from "@preprocess/ui/lib/utils";
import { motion } from "motion/react";
import {
  createContext,
  forwardRef,
  useContext,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
  type RefCallback,
} from "react";

/** True inside a Toolbar, whose one hover highlight replaces each item's own. */
const InToolbarContext = createContext(false);

/**
 * A header's row of tabs and icon buttons sharing one hover highlight that
 * glides between them, the way a menu's rows do. Items register by
 * `index`, left to right.
 */
export function Toolbar({
  label,
  className,
  children,
}: Readonly<{ label: string; className?: string; children: ReactNode }>) {
  return (
    <InToolbarContext.Provider value={true}>
      <HoverScope
        aria-label={label}
        axis="x"
        className={cn("flex items-center gap-0.5", className)}
        role="toolbar"
      >
        {children}
      </HoverScope>
    </InToolbarContext.Provider>
  );
}

function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: T | null }).current = node;
    }
  };
}

/**
 * A square icon button for a Toolbar. In one it leaves hover to the shared
 * highlight; on its own it draws its own hover, like a ghost button.
 * Forwards its ref and props, so it can be a dropdown or tooltip trigger.
 */
export const ToolbarButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    index: number;
    /** Filled: its menu is open, or what it controls is in effect. */
    active?: boolean;
  }
>(function ToolbarButton(
  { index, active = false, className, onFocus, onBlur, ...props },
  ref,
) {
  const inToolbar = useContext(InToolbarContext);
  const shape = useShape();
  const item = useHoverScopeItem<HTMLButtonElement>(index);
  return (
    <button
      className={cn(
        "relative z-10 flex size-7 shrink-0 cursor-pointer items-center justify-center text-muted-foreground outline-none transition-colors duration-80 hover:text-foreground focus-visible:ring-1 focus-visible:ring-(--focus-ring) [&_svg]:size-4",
        shape.item,
        !inToolbar && "hover:bg-hover",
        active && "bg-active text-foreground",
        className,
      )}
      onBlur={(event) => {
        item.onBlur();
        onBlur?.(event);
      }}
      onFocus={(event) => {
        item.onFocus(event);
        onFocus?.(event);
      }}
      ref={mergeRefs(ref, item.ref)}
      type="button"
      {...props}
    />
  );
});

/**
 * Tabs for a Toolbar: the selected tab's fill springs between them, and
 * hover comes from the toolbar's shared highlight.
 */
export function ToolbarTabs<T extends string>({
  label,
  layoutId,
  tabs,
  selected,
  onSelect,
  startIndex = 0,
}: Readonly<{
  label: string;
  /** Unique per page, so the selected fill animates within these tabs. */
  layoutId: string;
  tabs: readonly { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  /** The first tab's index among the toolbar's items. */
  startIndex?: number;
}>) {
  return (
    <div
      aria-label={label}
      className="flex items-center gap-0.5"
      role="tablist"
    >
      {tabs.map((tab, offset) => (
        <ToolbarTab
          index={startIndex + offset}
          key={tab.value}
          label={tab.label}
          layoutId={layoutId}
          onSelect={() => onSelect(tab.value)}
          selected={tab.value === selected}
        />
      ))}
    </div>
  );
}

function ToolbarTab({
  index,
  label,
  layoutId,
  selected,
  onSelect,
}: Readonly<{
  index: number;
  label: string;
  layoutId: string;
  selected: boolean;
  onSelect: () => void;
}>) {
  const shape = useShape();
  const item = useHoverScopeItem<HTMLButtonElement>(index);
  return (
    <button
      aria-selected={selected}
      className={cn(
        "relative z-10 flex h-7 shrink-0 cursor-pointer items-center px-2.5 text-body outline-none transition-colors duration-80 hover:text-foreground focus-visible:ring-1 focus-visible:ring-(--focus-ring)",
        shape.item,
        selected ? "text-foreground" : "text-muted-foreground",
      )}
      onBlur={item.onBlur}
      onClick={onSelect}
      onFocus={item.onFocus}
      ref={item.ref}
      role="tab"
      type="button"
    >
      {selected ? (
        <motion.span
          aria-hidden="true"
          className={cn("absolute inset-0 -z-10 bg-active", shape.bg)}
          layoutId={layoutId}
          transition={spring.moderate}
        />
      ) : null}
      {/* An invisible semibold copy holds the width, so the selected weight
          never shifts the tabs beside it. */}
      <span className="inline-grid whitespace-nowrap">
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {label}
        </span>
        <span
          className="col-start-1 row-start-1"
          style={{
            fontVariationSettings: selected
              ? fontWeights.semibold
              : fontWeights.normal,
          }}
        >
          {label}
        </span>
      </span>
    </button>
  );
}
