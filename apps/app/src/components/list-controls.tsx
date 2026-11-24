import { Button } from "@preprocess/ui/components/button";
import {
  DropdownContent,
  DropdownEmpty,
  DropdownMenu,
  DropdownSearch,
  DropdownSeparator,
  DropdownSub,
  DropdownSubContent,
  DropdownSubTrigger,
  DropdownTrigger,
} from "@preprocess/ui/components/dropdown";
import { MenuItem } from "@preprocess/ui/components/menu-item";
import { Tooltip } from "@preprocess/ui/components/tooltip";
import type { IconComponent } from "@preprocess/ui/lib/icon-context";
import { FilterIcon, XIcon } from "@preprocess/ui/lib/icons";
import { cn } from "@preprocess/ui/lib/utils";
import { useState } from "react";

import { ShortcutTooltipLabel } from "./shortcut-tooltip-label";
import { ToolbarButton } from "./toolbar";
import { useHotkeys } from "./use-hotkeys";

export type FilterOption = {
  readonly value: string;
  readonly label: string;
  /** The value's own mark, like a status glyph. Values without one show
   *  no icon: the facet's icon on every row would only repeat itself. */
  readonly icon?: IconComponent;
  /** How many items in the list have this value. */
  readonly count?: number;
};

export type FilterFacetDef = {
  readonly key: string;
  readonly label: string;
  readonly icon: IconComponent;
  readonly options: readonly FilterOption[];
  readonly selected: readonly string[];
  readonly onChange: (next: string[]) => void;
};

/** The filter menus' field, after Linear's: no magnifier and a taller row
 *  with more inset, so it reads as the place to type. No divider under it;
 *  the row's height sets it apart from the list. */
const FILTER_FIELD = "h-11 border-b-0 px-3.5";
/** Tells the list's fade where the 44px field ends, so rows fade below it. */
const FILTER_FADE = "[--scroll-fade-offset:44px]";

function toggle(selected: readonly string[], value: string) {
  return selected.includes(value)
    ? selected.filter((item) => item !== value)
    : [...selected, value];
}

function matchesQuery(label: string, query: string) {
  return label.toLowerCase().includes(query);
}

/** One facet's submenu: a "Filter…" field over its values and counts. */
function FacetSubmenu({
  facet,
  index,
  countLabel,
}: Readonly<{
  facet: FilterFacetDef;
  index: number;
  countLabel: (count: number) => string;
}>) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const options = normalized
    ? facet.options.filter((option) => matchesQuery(option.label, normalized))
    : facet.options;
  const checkedIndices = options.flatMap((option, row) =>
    facet.selected.includes(option.value) ? [row] : [],
  );

  return (
    <DropdownSub onOpenChange={(open) => (open ? undefined : setQuery(""))}>
      <DropdownSubTrigger icon={facet.icon} index={index} label={facet.label} />
      <DropdownSubContent
        checkedIndices={checkedIndices}
        className={cn("w-60", FILTER_FADE)}
      >
        <DropdownSearch
          aria-label={`Filter ${facet.label.toLowerCase()}`}
          className={FILTER_FIELD}
          hideIcon
          onValueChange={setQuery}
          placeholder="Filter…"
          value={query}
        />
        {options.length > 0 ? (
          options.map((option, row) => (
            <MenuItem
              checked={facet.selected.includes(option.value)}
              detail={
                option.count === undefined
                  ? undefined
                  : countLabel(option.count)
              }
              icon={option.icon}
              index={row}
              key={option.value}
              label={option.label}
              onSelect={() =>
                facet.onChange(toggle(facet.selected, option.value))
              }
            />
          ))
        ) : (
          <DropdownEmpty>No matches</DropdownEmpty>
        )}
      </DropdownSubContent>
    </DropdownSub>
  );
}

/**
 * A list's Filter menu, after Linear's: an icon button (F opens it), an
 * "Add filter…" field over the facets, and a submenu per facet listing its
 * values with their marks and counts. Typing in the top field also finds
 * values across every facet, so "waiting" offers the Waiting status
 * directly.
 */
export function FilterMenu({
  facets,
  countLabel,
  toolbarIndex = 0,
}: Readonly<{
  facets: readonly FilterFacetDef[];
  /** The button's place among a Toolbar's items, when it sits in one. */
  toolbarIndex?: number;
  /** "1 case", "12 cases": the noun for a value's count. */
  countLabel: (count: number) => string;
}>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const active = facets.some((facet) => facet.selected.length > 0);
  const normalized = query.trim().toLowerCase();

  useHotkeys({ f: () => setOpen(true) });

  const facetRows = normalized
    ? facets.filter((facet) => matchesQuery(facet.label, normalized))
    : facets;
  const valueRows = normalized
    ? facets.flatMap((facet) =>
        facet.options
          .filter((option) => matchesQuery(option.label, normalized))
          .map((option) => ({ facet, option })),
      )
    : [];
  const valueStart = facetRows.length;
  const checkedIndices = valueRows.flatMap(({ facet, option }, row) =>
    facet.selected.includes(option.value) ? [valueStart + row] : [],
  );

  return (
    <DropdownMenu
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      open={open}
      // The menu opens at the default size, though the header is compact.
      size="default"
    >
      <Tooltip
        content={<ShortcutTooltipLabel keys={["F"]} label="Filter" />}
        side="bottom"
      >
        <DropdownTrigger
          aria-label="Filter"
          render={
            <ToolbarButton active={open || active} index={toolbarIndex} />
          }
        >
          <FilterIcon aria-hidden="true" />
        </DropdownTrigger>
      </Tooltip>
      <DropdownContent
        align="end"
        checkedIndices={checkedIndices}
        className={cn("w-60", FILTER_FADE)}
      >
        <DropdownSearch
          aria-label="Add filter"
          className={FILTER_FIELD}
          hideIcon
          onValueChange={setQuery}
          placeholder="Add filter…"
          trailing={
            <kbd className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-hover px-1.5 font-sans text-caption text-muted-foreground">
              F
            </kbd>
          }
          value={query}
        />
        {facetRows.map((facet, index) => (
          <FacetSubmenu
            countLabel={countLabel}
            facet={facet}
            index={index}
            key={facet.key}
          />
        ))}
        {valueRows.length > 0 && facetRows.length > 0 ? (
          <DropdownSeparator />
        ) : null}
        {valueRows.map(({ facet, option }, row) => (
          <MenuItem
            checked={facet.selected.includes(option.value)}
            detail={facet.label}
            icon={option.icon}
            index={valueStart + row}
            key={`${facet.key}:${option.value}`}
            label={option.label}
            onSelect={() =>
              facet.onChange(toggle(facet.selected, option.value))
            }
          />
        ))}
        {facetRows.length === 0 && valueRows.length === 0 ? (
          <DropdownEmpty>No filters match</DropdownEmpty>
        ) : null}
      </DropdownContent>
    </DropdownMenu>
  );
}

export type FilterChip = {
  readonly key: string;
  /** Names the filter for the clear button: "Clear status filter". */
  readonly label: string;
  /** The muted start of the sentence: "Status is", "Awaiting one of". */
  readonly lead: string;
  /** The values, already joined: "Open, Waiting". Empty hides the chip. */
  readonly values: string;
  readonly onClear: () => void;
};

/** The active filters under a list's header, each a chip that clears it. */
export function FilterChips({
  chips,
  onClearAll,
}: Readonly<{ chips: readonly FilterChip[]; onClearAll: () => void }>) {
  const visible = chips.filter((chip) => chip.values !== "");
  if (visible.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pt-2">
      {visible.map((chip) => (
        <Button
          aria-label={`Clear ${chip.label.toLowerCase()} filter`}
          key={chip.key}
          onClick={chip.onClear}
          size="compact"
          trailingIcon={XIcon}
          type="button"
          variant="secondary"
        >
          <span className="flex min-w-0 items-center gap-1">
            <span className="text-muted-foreground">{chip.lead}</span>
            <span className="max-w-64 truncate">{chip.values}</span>
          </span>
        </Button>
      ))}
      {visible.length > 1 ? (
        <Button
          onClick={onClearAll}
          size="compact"
          type="button"
          variant="ghost"
        >
          Clear all
        </Button>
      ) : null}
    </div>
  );
}
