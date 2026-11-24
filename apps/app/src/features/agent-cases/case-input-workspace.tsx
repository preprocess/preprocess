"use client";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyPresence,
  EmptyTitle,
} from "@preprocess/ui/components/empty";
import { Button } from "@preprocess/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@preprocess/ui/components/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@preprocess/ui/components/context-menu";
import {
  DropdownContent,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from "@preprocess/ui/components/dropdown";
import { FluidHoverHighlight } from "@preprocess/ui/components/fluid-hover-highlight";
import { MenuItem } from "@preprocess/ui/components/menu-item";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { Tooltip } from "@preprocess/ui/components/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@preprocess/ui/hooks/use-fluid-hover";
import {
  ChevronDownIcon,
  DownloadIcon,
  FilterIcon,
} from "@preprocess/ui/lib/icons";
import { ShapeProvider, useShape } from "@preprocess/ui/lib/shape-context";
import { SizeProvider } from "@preprocess/ui/lib/size-context";
import { cn } from "@preprocess/ui/lib/utils";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  canOpenInput,
  CASE_INPUT_FAMILIES,
  familyLabel,
  familyOf,
  type CaseInputFamily,
} from "./case-input-kind";
import { FunnelArt, NoMatchArt } from "../../components/empty-art";
import { SettingsSearchField } from "../settings/kit";
import { CaseInputViewer } from "./case-input-viewer";
import { filesFromZip } from "./case-input-zip";
import type { CaseInputSample } from "./flue-lab-input-samples";

export const INPUT_TAB = "input";

export type CaseFileTab = {
  readonly id: string;
  readonly name: string;
};

export type CaseInputItem = {
  readonly id: string;
  readonly file: File;
  readonly family: CaseInputFamily;
  readonly url: string;
  readonly parentId?: string;
};

export type CaseInputWorkspaceProps = {
  readonly idPrefix?: string;
  readonly samples?: ReadonlyArray<CaseInputSample>;
  readonly activeId?: string;
  readonly onActiveIdChange?: (id: string) => void;
  readonly openIds?: readonly string[];
  readonly onOpenIdsChange?: (ids: string[]) => void;
  readonly onOpenItem?: (id: string) => void;
  readonly onOpenItemInBackground?: (ids: readonly string[]) => void;
  readonly onOpenItemInOtherPane?: (ids: readonly string[]) => void;
  readonly hidden?: boolean;
  readonly children?: ReactNode;
};

export function fileTabsFor(
  openIds: readonly string[],
  items: readonly CaseInputItem[],
): CaseFileTab[] {
  return openIds
    .map((id) => items.find((item) => item.id === id))
    .filter(
      (item): item is CaseInputItem =>
        item != null && canOpenInput(item.file.name, item.file.type),
    )
    .map((item) => ({ id: item.id, name: item.file.name }));
}

export type InputListClick = {
  readonly additive: boolean;
  readonly range: boolean;
};

export function clickFromPointer(event: {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): InputListClick {
  return {
    additive: event.metaKey || event.ctrlKey,
    range: event.shiftKey,
  };
}

function idsBetween(
  visibleIds: readonly string[],
  fromId: string,
  toId: string,
): string[] {
  const from = visibleIds.indexOf(fromId);
  const to = visibleIds.indexOf(toId);
  if (from === -1 || to === -1) return [toId];
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return visibleIds.slice(start, end + 1);
}

export function nextInputListSelection(input: {
  readonly visibleIds: readonly string[];
  readonly selectedIds: readonly string[];
  readonly anchorId: string | null;
  readonly rangeEndId: string | null;
  readonly id: string;
  readonly click: InputListClick;
}): {
  readonly selectedIds: string[];
  readonly anchorId: string | null;
  readonly rangeEndId: string | null;
} {
  const { visibleIds, selectedIds, anchorId, rangeEndId, id, click } = input;
  if (click.range) {
    const fromId = anchorId ?? id;
    const region = rangeEndId ? idsBetween(visibleIds, fromId, rangeEndId) : [];
    const topId = region[0];
    if (rangeEndId && topId && id === topId) {
      const drop = new Set(region);
      const remaining = selectedIds.filter((value) => !drop.has(value));
      return {
        selectedIds: remaining,
        anchorId: remaining.includes(fromId) ? fromId : null,
        rangeEndId: null,
      };
    }
    const rangeIds = idsBetween(visibleIds, fromId, id);
    return {
      selectedIds: click.additive
        ? unionIds(selectedIds, rangeIds)
        : [...rangeIds],
      anchorId: fromId,
      rangeEndId: id === fromId ? null : id,
    };
  }
  if (click.additive) {
    return {
      selectedIds: selectedIds.includes(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id],
      anchorId: id,
      rangeEndId: null,
    };
  }
  return { selectedIds: [id], anchorId: id, rangeEndId: null };
}

function unionIds(
  current: readonly string[],
  added: readonly string[],
): string[] {
  const next = [...current];
  for (const id of added) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

function visibleItemIds(
  rows: readonly {
    item: CaseInputItem;
    children?: readonly CaseInputItem[];
  }[],
): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    ids.push(row.item.id);
    if (!row.children) continue;
    for (const child of row.children) ids.push(child.id);
  }
  return ids;
}

export function moveOpenTab(
  openIds: readonly string[],
  id: string,
  delta: number,
): string[] {
  const from = openIds.indexOf(id);
  if (from === -1 || delta === 0) return [...openIds];
  const to = from + delta;
  if (to < 0 || to >= openIds.length) return [...openIds];
  const next = [...openIds];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...openIds];
  next.splice(to, 0, moved);
  return next;
}

async function itemsFromSamples(
  samples: ReadonlyArray<CaseInputSample>,
): Promise<CaseInputItem[]> {
  const next: CaseInputItem[] = [];
  for (const sample of samples) {
    const body =
      typeof sample.body === "string"
        ? sample.body
        : new Uint8Array(sample.body);
    const file = new File([body], sample.name, { type: sample.type });
    const family = familyOf(sample.name, sample.type);
    const item: CaseInputItem = {
      id: sample.id,
      file,
      family,
      url: family === "archive" ? "" : URL.createObjectURL(file),
    };
    next.push(item);
    if (family !== "archive") continue;
    const members = await filesFromZip(file);
    for (const member of members) {
      next.push(itemFromFile(member.file, item.id));
    }
  }
  return next;
}

function itemFromFile(file: File, parentId?: string): CaseInputItem {
  const family = familyOf(file.name, file.type);
  return {
    id: crypto.randomUUID(),
    file,
    family,
    url: family === "archive" ? "" : URL.createObjectURL(file),
    parentId,
  };
}

async function itemsFromFiles(
  files: FileList | File[],
): Promise<CaseInputItem[]> {
  const next: CaseInputItem[] = [];
  for (const file of Array.from(files)) {
    const item = itemFromFile(file);
    next.push(item);
    if (item.family !== "archive") continue;
    const members = await filesFromZip(file);
    for (const member of members) {
      next.push(itemFromFile(member.file, item.id));
    }
  }
  return next;
}

function isTabDrag(transfer: DataTransfer | null) {
  const types = transfer?.types;
  if (!types) return false;
  return Array.from(types).includes("application/x-case-file-tab");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useOptionalList(
  value: readonly string[] | undefined,
  onChange: ((ids: string[]) => void) | undefined,
): [string[], (next: string[] | ((current: string[]) => string[])) => void] {
  const [uncontrolled, setUncontrolled] = useState<string[]>([]);
  const isControlled = value !== undefined;
  const current = isControlled ? [...value] : uncontrolled;
  const set = (next: string[] | ((prev: string[]) => string[])) => {
    const resolved = typeof next === "function" ? next(current) : next;
    if (!isControlled) setUncontrolled(resolved);
    onChange?.(resolved);
  };
  return [current, set];
}

function useOptionalId(
  value: string | undefined,
  onChange: ((id: string) => void) | undefined,
  fallback: string,
): [string, (next: string | ((current: string) => string)) => void] {
  const [uncontrolled, setUncontrolled] = useState(fallback);
  const isControlled = value !== undefined;
  const current = isControlled ? value : uncontrolled;
  const set = (next: string | ((prev: string) => string)) => {
    const resolved = typeof next === "function" ? next(current) : next;
    if (!isControlled) setUncontrolled(resolved);
    onChange?.(resolved);
  };
  return [current, set];
}

type CaseInputContextValue = {
  readonly idPrefix: string;
  readonly items: CaseInputItem[];
  readonly openTabs: CaseInputItem[];
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly familyFilter: readonly CaseInputFamily[];
  readonly setFamilyFilter: (families: CaseInputFamily[]) => void;
  readonly availableFamilies: readonly CaseInputFamily[];
  readonly visibleRows: {
    item: CaseInputItem;
    children?: readonly CaseInputItem[];
  }[];
  readonly itemsReady: boolean;
  readonly selectedIds: readonly string[];
  readonly selectItem: (id: string, click: InputListClick) => void;
  readonly addFiles: (files: FileList | File[]) => void;
  readonly openItem: (id: string) => void;
  readonly openItemInBackground: (ids: readonly string[]) => void;
  readonly openItemInOtherPane?: (ids: readonly string[]) => void;
};

const CaseInputContext = createContext<CaseInputContextValue | null>(null);

function useCaseInput() {
  const context = useContext(CaseInputContext);
  if (!context) {
    throw new Error("CaseInputPane must be used within CaseInputWorkspace");
  }
  return context;
}

export function useCaseFileTabs(openIds: readonly string[]): CaseFileTab[] {
  const { items } = useCaseInput();
  return fileTabsFor(openIds, items);
}

export function CaseInputWorkspace({
  idPrefix = "case-input",
  samples,
  activeId: activeIdProp,
  onActiveIdChange,
  openIds: openIdsProp,
  onOpenIdsChange,
  onOpenItem,
  onOpenItemInBackground,
  onOpenItemInOtherPane,
  hidden = false,
  children,
}: CaseInputWorkspaceProps) {
  const [items, setItems] = useState<CaseInputItem[]>([]);
  const [itemsReady, setItemsReady] = useState(!samples?.length);
  const [openIds, setOpenIds] = useOptionalList(openIdsProp, onOpenIdsChange);
  const [activeId, setActiveId] = useOptionalId(
    activeIdProp,
    onActiveIdChange,
    INPUT_TAB,
  );
  const [query, setQuery] = useState("");
  const [familyFilter, setFamilyFilter] = useState<CaseInputFamily[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [rangeEndId, setRangeEndId] = useState<string | null>(null);

  useEffect(() => {
    if (!samples?.length) {
      setItemsReady(true);
      return;
    }
    let cancelled = false;
    let created: CaseInputItem[] = [];
    setItemsReady(false);
    setOpenIds([]);
    setActiveId(INPUT_TAB);
    setSelectedIds([]);
    setAnchorId(null);
    setRangeEndId(null);
    void itemsFromSamples(samples).then((seeded) => {
      created = seeded;
      if (cancelled) {
        for (const item of seeded) {
          if (item.url) URL.revokeObjectURL(item.url);
        }
        return;
      }
      setItems(seeded);
      setItemsReady(true);
    });
    return () => {
      cancelled = true;
      for (const item of created) {
        if (item.url) URL.revokeObjectURL(item.url);
      }
    };
  }, [samples]);

  const addFiles = (files: FileList | File[]) => {
    void itemsFromFiles(files).then((next) => {
      if (next.length === 0) return;
      setItems((current) => [...current, ...next]);
    });
  };

  const openableItem = (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (!item || !canOpenInput(item.file.name, item.file.type)) return null;
    return item;
  };

  const openItem = (id: string) => {
    if (!openableItem(id)) return;
    if (onOpenItem) {
      onOpenItem(id);
      return;
    }
    setOpenIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
    setActiveId(id);
  };

  const openableIds = (ids: readonly string[]) =>
    ids.filter((id) => openableItem(id));

  const openItemInBackground = (ids: readonly string[]) => {
    const next = openableIds(ids);
    if (next.length === 0) return;
    if (onOpenItemInBackground) {
      onOpenItemInBackground(next);
      return;
    }
    setOpenIds((current) => {
      let open = current;
      for (const id of next) {
        if (!open.includes(id)) open = [...open, id];
      }
      return open;
    });
  };

  const openItemInOtherPane = onOpenItemInOtherPane
    ? (ids: readonly string[]) => {
        const next = openableIds(ids);
        if (next.length === 0) return;
        onOpenItemInOtherPane(next);
      }
    : undefined;

  const openTabs = openIds
    .map((id) => items.find((item) => item.id === id))
    .filter(
      (item): item is CaseInputItem =>
        item != null && canOpenInput(item.file.name, item.file.type),
    );

  const availableFamilies = useMemo(() => {
    const present = new Set(items.map((item) => item.family));
    return CASE_INPUT_FAMILIES.filter((family) => present.has(family));
  }, [items]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (item: CaseInputItem) => {
      if (familyFilter.length > 0 && !familyFilter.includes(item.family)) {
        return false;
      }
      if (!needle) return true;
      return [item.file.name, familyLabel(item.family)].some((value) =>
        value.toLowerCase().includes(needle),
      );
    };
    const rows: {
      item: CaseInputItem;
      children?: readonly CaseInputItem[];
    }[] = [];
    for (const item of items) {
      if (item.parentId) continue;
      if (item.family === "archive") {
        const children = items.filter((child) => child.parentId === item.id);
        const visibleChildren = children.filter(matches);
        if (!matches(item) && visibleChildren.length === 0) continue;
        rows.push({
          item,
          children:
            matches(item) && familyFilter.length === 0 && !needle
              ? children
              : visibleChildren,
        });
        continue;
      }
      if (matches(item)) rows.push({ item });
    }
    return rows;
  }, [familyFilter, items, query]);

  const selectItem = (id: string, click: InputListClick) => {
    const next = nextInputListSelection({
      visibleIds: visibleItemIds(visibleRows),
      selectedIds,
      anchorId,
      rangeEndId,
      id,
      click,
    });
    setSelectedIds(next.selectedIds);
    setAnchorId(next.anchorId);
    setRangeEndId(next.rangeEndId);
  };

  return (
    <CaseInputContext.Provider
      value={{
        idPrefix,
        items,
        openTabs,
        query,
        setQuery,
        familyFilter,
        setFamilyFilter,
        availableFamilies,
        visibleRows,
        itemsReady,
        selectedIds,
        selectItem,
        addFiles,
        openItem,
        openItemInBackground,
        openItemInOtherPane,
      }}
    >
      <div
        className="flex h-full min-h-0 flex-col bg-surface-2"
        data-testid="case-input-workspace"
        hidden={hidden}
      >
        {children ?? <CaseInputPane id={activeId} />}
      </div>
    </CaseInputContext.Provider>
  );
}

/** Hands each list row its slot in the list's fluid hover. */
const RowHoverContext = createContext<
  ((index: number, element: HTMLElement | null) => void) | undefined
>(undefined);

function useRowHover<T extends HTMLElement>(index: number | undefined) {
  const ref = useRef<T>(null);
  useRegisterFluidHoverItem(useContext(RowHoverContext), index, ref);
  return ref;
}

function rowSurfaceClass(
  shapeClass: string,
  selected: boolean,
  menuOpen = false,
) {
  return cn(
    "relative flex w-full min-w-0 cursor-pointer items-center px-3 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring)",
    shapeClass,
    (selected || menuOpen) && "bg-active",
  );
}

function addTabsMenuLabel(count: number, other: boolean): string {
  if (other) {
    return count > 1 ? "Add tabs to other panel" : "Add tab to other panel";
  }
  return count > 1 ? "Add tabs" : "Add tab";
}

function FileRow({
  item,
  index,
  selected,
  selectedOpenableIds,
  onSelect,
  onOpen,
  onOpenInBackground,
  onOpenInOtherPane,
}: {
  item: CaseInputItem;
  index: number;
  selected: boolean;
  selectedOpenableIds: readonly string[];
  onSelect: (id: string, click: InputListClick) => void;
  onOpen: (id: string) => void;
  onOpenInBackground: (ids: readonly string[]) => void;
  onOpenInOtherPane?: (ids: readonly string[]) => void;
}) {
  const openable = canOpenInput(item.file.name, item.file.type);
  const [menuOpen, setMenuOpen] = useState(false);
  const shape = useShape();
  const buttonRef = useRowHover<HTMLButtonElement>(
    openable ? index : undefined,
  );
  const rowRef = useRowHover<HTMLDivElement>(openable ? undefined : index);
  const label = (
    <span className="flex min-w-0 flex-1 flex-col items-start">
      <span className="w-full truncate text-body text-foreground">
        {item.file.name}
      </span>
      <span className="text-caption text-muted-foreground">
        {familyLabel(item.family)} · {formatSize(item.file.size)}
      </span>
    </span>
  );
  const activate = (event: {
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }) => {
    const click = clickFromPointer(event);
    onSelect(item.id, click);
    if (openable && !click.additive && !click.range) onOpen(item.id);
  };
  const menuIds =
    selected && selectedOpenableIds.includes(item.id)
      ? selectedOpenableIds
      : openable
        ? [item.id]
        : [];
  if (openable) {
    return (
      <ContextMenu onOpenChange={setMenuOpen}>
        <ContextMenuTrigger className="block w-full">
          <button
            aria-label={`Open ${item.file.name}`}
            aria-selected={selected}
            className={rowSurfaceClass(shape.item, selected, menuOpen)}
            onClick={activate}
            ref={buttonRef}
            onContextMenu={() => {
              if (!selected) {
                onSelect(item.id, { additive: false, range: false });
              }
            }}
            type="button"
          >
            {label}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-44">
          <ContextMenuItem onClick={() => onOpenInBackground(menuIds)}>
            {addTabsMenuLabel(menuIds.length, false)}
          </ContextMenuItem>
          {onOpenInOtherPane ? (
            <ContextMenuItem onClick={() => onOpenInOtherPane(menuIds)}>
              {addTabsMenuLabel(menuIds.length, true)}
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    );
  }
  return (
    <div
      className={cn(
        "relative flex w-full items-center gap-2 pr-1.5",
        shape.item,
        selected && "bg-active",
      )}
      ref={rowRef}
    >
      <button
        aria-label={`Select ${item.file.name}`}
        aria-selected={selected}
        className={cn(rowSurfaceClass(shape.item, false), "flex-1 pr-0")}
        onClick={activate}
        type="button"
      >
        {label}
      </button>
      <Button asChild size="icon-compact" variant="ghost">
        <a
          aria-label={`Download ${item.file.name}`}
          download={item.file.name}
          href={item.url}
        >
          <DownloadIcon aria-hidden="true" />
        </a>
      </Button>
    </div>
  );
}

function ArchiveRow({
  item,
  index,
  members,
  selectedIds,
  selectedOpenableIds,
  onSelect,
  onOpen,
  onOpenInBackground,
  onOpenInOtherPane,
}: {
  item: CaseInputItem;
  index: number;
  members: readonly CaseInputItem[];
  selectedIds: ReadonlySet<string>;
  selectedOpenableIds: readonly string[];
  onSelect: (id: string, click: InputListClick) => void;
  onOpen: (id: string) => void;
  onOpenInBackground: (ids: readonly string[]) => void;
  onOpenInOtherPane?: (ids: readonly string[]) => void;
}) {
  const selected = selectedIds.has(item.id);
  const shape = useShape();
  const triggerRef = useRowHover<HTMLButtonElement>(index);
  return (
    <li>
      <Collapsible className="flex flex-col" defaultOpen>
        <CollapsibleTrigger
          aria-label={`Toggle ${item.file.name}`}
          aria-selected={selected}
          className={cn(rowSurfaceClass(shape.item, selected), "group gap-2")}
          ref={triggerRef}
          onPointerDown={(event) => {
            const click = clickFromPointer(event);
            if (!click.additive && !click.range) return;
            event.preventDefault();
            onSelect(item.id, click);
          }}
          onClick={(event) => {
            const click = clickFromPointer(event);
            if (click.additive || click.range) {
              event.preventDefault();
              return;
            }
            onSelect(item.id, click);
          }}
        >
          <span className="flex min-w-0 flex-1 flex-col items-start">
            <span className="w-full truncate text-body text-foreground">
              {item.file.name}
            </span>
            <span className="text-caption text-muted-foreground">
              {familyLabel(item.family)}
              {members.length > 0
                ? ` · ${members.length} ${members.length === 1 ? "file" : "files"}`
                : ` · ${formatSize(item.file.size)}`}
            </span>
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 -rotate-90 text-muted-foreground transition-transform group-data-open:rotate-0 group-data-panel-open:rotate-0"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="flex flex-col gap-1 pt-1">
            {members.map((child, offset) => (
              <li key={child.id}>
                <FileRow
                  index={index + 1 + offset}
                  item={child}
                  onOpen={onOpen}
                  onOpenInBackground={onOpenInBackground}
                  onOpenInOtherPane={onOpenInOtherPane}
                  onSelect={onSelect}
                  selected={selectedIds.has(child.id)}
                  selectedOpenableIds={selectedOpenableIds}
                />
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function FileRowList({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLUListElement>(null);
  const hover = useFluidHover(containerRef);
  const shape = useShape();
  return (
    <RowHoverContext.Provider value={hover.registerItem}>
      <ul
        className="relative flex select-none flex-col gap-1 px-2 pb-2"
        onMouseEnter={hover.handlers.onMouseEnter}
        onMouseLeave={hover.handlers.onMouseLeave}
        onMouseMove={hover.handlers.onMouseMove}
        ref={containerRef}
      >
        <FluidHoverHighlight hover={hover} className={shape.bg} />
        {children}
      </ul>
    </RowHoverContext.Provider>
  );
}

function FileFamilyFilter({
  families,
  selected,
  onChange,
}: {
  families: readonly CaseInputFamily[];
  selected: readonly CaseInputFamily[];
  onChange: (next: CaseInputFamily[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const checkedIndices = families.flatMap((family, index) =>
    selected.includes(family) ? [index] : [],
  );
  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <Tooltip content="Filter by type" side="bottom">
        <DropdownTrigger
          aria-label="Filter files"
          render={
            <Button
              active={open}
              size="icon-compact"
              type="button"
              variant={selected.length > 0 ? "secondary" : "ghost"}
            />
          }
        >
          <FilterIcon aria-hidden="true" />
        </DropdownTrigger>
      </Tooltip>
      <DropdownContent
        align="end"
        checkedIndices={checkedIndices}
        className="w-44"
      >
        <DropdownLabel>Type</DropdownLabel>
        {families.map((family, index) => {
          const checked = selected.includes(family);
          return (
            <MenuItem
              checked={checked}
              index={index}
              key={family}
              label={familyLabel(family)}
              onSelect={() =>
                onChange(
                  checked
                    ? selected.filter((value) => value !== family)
                    : [...selected, family],
                )
              }
            />
          );
        })}
        {selected.length > 0 ? (
          <>
            <DropdownSeparator />
            <MenuItem
              index={families.length}
              label="Clear filter"
              onSelect={() => onChange([])}
            />
          </>
        ) : null}
      </DropdownContent>
    </DropdownMenu>
  );
}

export function CaseInputPane({
  id,
  idPrefix: idPrefixProp,
}: {
  readonly id: string;
  readonly idPrefix?: string;
}) {
  const {
    idPrefix: contextPrefix,
    query,
    setQuery,
    familyFilter,
    setFamilyFilter,
    availableFamilies,
    visibleRows,
    items,
    itemsReady,
    selectedIds,
    selectItem,
    addFiles,
    openItem,
    openItemInBackground,
    openItemInOtherPane,
  } = useCaseInput();
  const idPrefix = idPrefixProp ?? contextPrefix;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedOpenableIds = useMemo(
    () =>
      selectedIds.filter((id) => {
        const item = items.find((entry) => entry.id === id);
        return item != null && canOpenInput(item.file.name, item.file.type);
      }),
    [items, selectedIds],
  );
  const listRef = useRef<HTMLDivElement>(null);
  // Hover slots run through archives and their members in display order.
  const rowIndexes = useMemo(() => {
    let next = 0;
    return visibleRows.map(({ children }) => {
      const index = next;
      next += 1 + (children?.length ?? 0);
      return index;
    });
  }, [visibleRows]);
  useLayoutEffect(() => {
    if (id !== INPUT_TAB) return;
    const viewport = listRef.current?.querySelector<HTMLElement>(
      "[data-slot=scroll-area-viewport]",
    );
    if (viewport) viewport.scrollTop = 0;
  }, [familyFilter, id, query]);

  if (id !== INPUT_TAB) {
    return <CaseInputFilePane id={id} idPrefix={idPrefix} />;
  }

  return (
    <div
      aria-labelledby={`${idPrefix}-tab-${INPUT_TAB}`}
      className="flex min-h-0 flex-1 flex-col outline-none"
      id={`${idPrefix}-panel-${INPUT_TAB}`}
      onDragOver={(event) => {
        if (isTabDrag(event.dataTransfer)) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (isTabDrag(event.dataTransfer)) return;
        event.preventDefault();
        addFiles(event.dataTransfer.files);
      }}
      role="tabpanel"
    >
      <SizeProvider size="compact">
        <div className="flex shrink-0 items-center gap-1 px-2 pb-2">
          <SettingsSearchField
            label="Search files"
            onChange={setQuery}
            placeholder="Search files"
            value={query}
          />
          <FileFamilyFilter
            families={availableFamilies}
            onChange={setFamilyFilter}
            selected={familyFilter}
          />
        </div>
      </SizeProvider>
      <div className="relative min-h-0 flex-1">
        <EmptyPresence mode="wait">
          {itemsReady && visibleRows.length === 0 ? (
            <Empty
              key={query.trim() === "" ? "input-empty" : "input-no-results"}
              className="pointer-events-none absolute inset-0 z-[1] border-0 p-0"
            >
              <EmptyHeader className="pointer-events-auto group">
                <EmptyMedia variant="graphic">
                  {query.trim() === "" ? <FunnelArt /> : <NoMatchArt />}
                </EmptyMedia>
                {query.trim() === "" ? (
                  <>
                    <EmptyTitle>No input found</EmptyTitle>
                    <EmptyDescription>
                      Add input to start this case.
                    </EmptyDescription>
                  </>
                ) : (
                  <>
                    <EmptyTitle>No results found</EmptyTitle>
                    <EmptyDescription>
                      Nothing matches “{query.trim()}”.
                    </EmptyDescription>
                  </>
                )}
              </EmptyHeader>
            </Empty>
          ) : null}
        </EmptyPresence>
        <ScrollArea
          ref={listRef}
          className="min-h-0 h-full"
          viewportClassName="scroll-fade"
        >
          {visibleRows.length === 0 ? null : (
            <ShapeProvider defaultShape="rounded">
              <FileRowList>
                {visibleRows.map(({ item, children }, rowIndex) => {
                  const index = rowIndexes[rowIndex] ?? 0;
                  if (children) {
                    return (
                      <ArchiveRow
                        index={index}
                        item={item}
                        key={item.id}
                        members={children}
                        onOpen={openItem}
                        onOpenInBackground={openItemInBackground}
                        onOpenInOtherPane={openItemInOtherPane}
                        onSelect={selectItem}
                        selectedIds={selectedIdSet}
                        selectedOpenableIds={selectedOpenableIds}
                      />
                    );
                  }
                  return (
                    <li key={item.id}>
                      <FileRow
                        index={index}
                        item={item}
                        onOpen={openItem}
                        onOpenInBackground={openItemInBackground}
                        onOpenInOtherPane={openItemInOtherPane}
                        onSelect={selectItem}
                        selected={selectedIdSet.has(item.id)}
                        selectedOpenableIds={selectedOpenableIds}
                      />
                    </li>
                  );
                })}
              </FileRowList>
            </ShapeProvider>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

function CaseInputFilePane({
  id,
  idPrefix,
}: {
  readonly id: string;
  readonly idPrefix: string;
}) {
  const { items } = useCaseInput();
  const item = items.find((entry) => entry.id === id);
  if (!item || !canOpenInput(item.file.name, item.file.type)) return null;

  return (
    <div
      aria-labelledby={`${idPrefix}-tab-${item.id}`}
      className="flex min-h-0 flex-1 flex-col bg-surface-2 outline-none"
      id={`${idPrefix}-panel-${item.id}`}
      role="tabpanel"
    >
      <CaseInputViewer item={item} />
    </div>
  );
}
