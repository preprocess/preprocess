"use client";

import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
  type ItemRect,
} from "@preprocess/ui/hooks/use-fluid-hover";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  Clock,
  FileIcon,
  ListIcon,
  MessageCircle,
  XIcon,
} from "@preprocess/ui/lib/icons";
import { useShape } from "@preprocess/ui/lib/shape-context";
import { spring } from "@preprocess/ui/lib/springs";
import { cn } from "@preprocess/ui/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type HTMLAttributes,
  type ReactNode,
  type SVGProps,
} from "react";

import {
  INPUT_TAB,
  moveOpenTab,
  type CaseFileTab,
} from "./case-input-workspace";

export const ROOM_VIEWS = [
  { id: INPUT_TAB, label: "Input", icon: FileIcon },
  { id: "review", label: "Review", icon: ListIcon },
  { id: "run", label: "Run", icon: Clock },
] as const;

export type RoomViewId = (typeof ROOM_VIEWS)[number]["id"];

/** Below the tablet breakpoint the chat is a view beside Input, Review and Run. */
export const CHAT_VIEW = { id: "chat", label: "Chat", icon: MessageCircle };

const ROOM_VIEW_IDS = new Set<string>(ROOM_VIEWS.map((view) => view.id));

export function isRoomViewId(id: string): id is RoomViewId {
  return ROOM_VIEW_IDS.has(id);
}

export function workspaceActiveIdOf(selectedId: string): string {
  return isRoomViewId(selectedId) && selectedId !== INPUT_TAB
    ? INPUT_TAB
    : selectedId;
}

export function closeOpenTab(
  openIds: readonly string[],
  id: string,
  selectedId: string,
): { openIds: string[]; selectedId: string } {
  const index = openIds.indexOf(id);
  const next = openIds.filter((openId) => openId !== id);
  if (selectedId !== id) return { openIds: next, selectedId };
  return {
    openIds: next,
    selectedId: next[index] ?? next[index - 1] ?? INPUT_TAB,
  };
}

export function openFileInPane(
  pane: { selectedId: string; openIds: readonly string[] },
  id: string,
): { selectedId: string; openIds: string[] } {
  if (isRoomViewId(id)) {
    return { selectedId: pane.selectedId, openIds: [...pane.openIds] };
  }
  return {
    selectedId: id,
    openIds: pane.openIds.includes(id)
      ? [...pane.openIds]
      : [...pane.openIds, id],
  };
}

export function openFileInPaneBackground(
  pane: { selectedId: string; openIds: readonly string[] },
  id: string,
): { selectedId: string; openIds: string[] } {
  if (isRoomViewId(id)) {
    return { selectedId: pane.selectedId, openIds: [...pane.openIds] };
  }
  return {
    selectedId: pane.selectedId,
    openIds: pane.openIds.includes(id)
      ? [...pane.openIds]
      : [...pane.openIds, id],
  };
}

export function assignFileToOtherPane(
  focused: "main" | "side",
  isSplit: boolean,
  main: { selectedId: string; openIds: readonly string[] },
  side: { selectedId: string; openIds: readonly string[] } | null,
  id: string,
): {
  main: { selectedId: string; openIds: string[] };
  side: { selectedId: string; openIds: string[] };
} {
  return assignFilesToOtherPane(focused, isSplit, main, side, [id]);
}

export function assignFilesToOtherPane(
  focused: "main" | "side",
  isSplit: boolean,
  main: { selectedId: string; openIds: readonly string[] },
  side: { selectedId: string; openIds: readonly string[] } | null,
  ids: readonly string[],
): {
  main: { selectedId: string; openIds: string[] };
  side: { selectedId: string; openIds: string[] };
} {
  let nextMain = { selectedId: main.selectedId, openIds: [...main.openIds] };
  let nextSide = side
    ? { selectedId: side.selectedId, openIds: [...side.openIds] }
    : { selectedId: INPUT_TAB, openIds: [] as string[] };
  let split = isSplit;
  for (const id of ids) {
    if (focused === "side" && split && side) {
      nextMain = openFileInPane(nextMain, id);
    } else {
      nextSide = openFileInPane(nextSide, id);
      split = true;
    }
  }
  return { main: nextMain, side: nextSide };
}

export function dropFilesFromPane(
  pane: { selectedId: string; openIds: readonly string[] },
  ids: readonly string[],
): { selectedId: string; openIds: string[] } {
  const drop = new Set(ids);
  let selectedId = pane.selectedId;
  let openIds = [...pane.openIds];
  for (const id of pane.openIds) {
    if (!drop.has(id)) continue;
    const next = closeOpenTab(openIds, id, selectedId);
    openIds = next.openIds;
    selectedId = next.selectedId;
  }
  return { openIds, selectedId };
}

export function insertFileInPane(
  pane: { selectedId: string; openIds: readonly string[] },
  id: string,
  index?: number,
): { selectedId: string; openIds: string[] } {
  if (isRoomViewId(id)) {
    return { selectedId: pane.selectedId, openIds: [...pane.openIds] };
  }
  const without = pane.openIds.filter((openId) => openId !== id);
  const to =
    index === undefined
      ? without.length
      : Math.max(0, Math.min(index, without.length));
  return {
    selectedId: id,
    openIds: [...without.slice(0, to), id, ...without.slice(to)],
  };
}

export function moveFileBetweenPanes(
  from: { selectedId: string; openIds: readonly string[] },
  to: { selectedId: string; openIds: readonly string[] },
  id: string,
  index?: number,
): {
  from: { selectedId: string; openIds: string[] };
  to: { selectedId: string; openIds: string[] };
} {
  return {
    from: dropFilesFromPane(from, [id]),
    to: insertFileInPane(to, id, index),
  };
}

export function insertOpenTab(
  openIds: readonly string[],
  id: string,
  index: number,
): string[] {
  const from = openIds.indexOf(id);
  const next = openIds.filter((openId) => openId !== id);
  const to = Math.max(
    0,
    Math.min(from !== -1 && from < index ? index - 1 : index, next.length),
  );
  next.splice(to, 0, id);
  return next;
}

type Glyph = ComponentType<SVGProps<SVGSVGElement>>;

export type CaseRoomTabsProps = {
  readonly idPrefix: string;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly fileTabs: readonly CaseFileTab[];
  readonly onCloseFile: (id: string) => void;
  readonly onReorderFiles: (ids: string[]) => void;
  readonly paneName?: "main" | "side";
  readonly onTransferFile?: (
    id: string,
    from: "main" | "side",
    index: number,
  ) => void;
  readonly toolbar?: ReactNode;
  readonly label?: string;
  readonly views?: readonly ViewTab<string>[];
};

export const FILE_TAB_MIME = "application/x-case-file-tab";
export const FILE_PANE_MIME = "application/x-case-file-pane";

let activeFileTabDrag: { id: string; from: string } | null = null;

export function isCaseFileTabDrag(event: DragEvent) {
  if (activeFileTabDrag) return true;
  const transfer = event.dataTransfer;
  if (!transfer) return false;
  return Array.from(transfer.types ?? []).includes(FILE_TAB_MIME);
}

export function fileTabDragOf(event: DragEvent) {
  if (activeFileTabDrag) return activeFileTabDrag;
  const transfer = event.dataTransfer;
  if (!transfer) return null;
  const id = transfer.getData(FILE_TAB_MIME);
  const from = transfer.getData(FILE_PANE_MIME);
  if (!id) return null;
  return { id, from };
}

type RegisterTab = (index: number, element: HTMLElement | null) => void;

function tabClass(shapeClass: string, movable = false) {
  return cn(
    "relative z-10 flex h-7 shrink-0 cursor-pointer select-none items-center text-body outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring)",
    shapeClass,
    movable ? "gap-1 pl-2.5 pr-1" : "gap-1.5 px-2.5",
  );
}

/**
 * A tab's label the way TabsSubtle draws it: an invisible semibold copy
 * holds the width, so the selected weight never shifts its neighbours.
 */
function TabLabel({
  children,
  selected,
  lit,
  className,
}: {
  children: ReactNode;
  selected: boolean;
  lit: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-grid whitespace-nowrap text-body", className)}>
      <span
        aria-hidden="true"
        className="invisible col-start-1 row-start-1 truncate"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {children}
      </span>
      <span
        className={cn(
          "col-start-1 row-start-1 truncate transition-[color,font-variation-settings] duration-80",
          lit ? "text-foreground" : "text-muted-foreground",
        )}
        style={{
          fontVariationSettings: selected
            ? fontWeights.semibold
            : fontWeights.normal,
        }}
      >
        {children}
      </span>
    </span>
  );
}

function RoomViewTab({
  view,
  index,
  idPrefix,
  selected,
  lit,
  registerTab,
  onSelect,
}: {
  view: { readonly id: string; readonly label: string; readonly icon: Glyph };
  index: number;
  idPrefix: string;
  selected: boolean;
  lit: boolean;
  registerTab: RegisterTab;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useRegisterFluidHoverItem(registerTab, index, ref);
  const shape = useShape();
  const Icon: Glyph = view.icon;
  return (
    <button
      aria-controls={`${idPrefix}-panel-${view.id}`}
      aria-selected={selected}
      className={tabClass(shape.item)}
      id={`${idPrefix}-tab-${view.id}`}
      onClick={() => onSelect(view.id)}
      ref={ref}
      role="tab"
      type="button"
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0 transition-colors duration-80",
          lit ? "text-foreground" : "text-muted-foreground",
        )}
      />
      <TabLabel lit={lit} selected={selected}>
        {view.label}
      </TabLabel>
    </button>
  );
}

function FileTab({
  index,
  registerTab,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  index: number;
  registerTab: RegisterTab;
  draggable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useRegisterFluidHoverItem(registerTab, index, ref);
  const shape = useShape();
  return (
    <div
      className={cn(tabClass(shape.item, true), className)}
      ref={ref}
      {...props}
    >
      {children}
    </div>
  );
}

const PILL_CLASS = "pointer-events-none absolute bg-active";

function rectTarget(rect: ItemRect) {
  return {
    left: rect.left,
    width: rect.width,
    top: rect.top,
    height: rect.height,
  };
}

/** The selected tab's underline along its bottom edge (spec 14a). */
function underlineTarget(rect: ItemRect) {
  return {
    left: rect.left + 6,
    width: Math.max(rect.width - 12, 0),
    top: rect.top + rect.height - 2,
    height: 2,
  };
}

/** The selected tab's underline and the hover pill, over this strip's own rects. */
function TabPills({
  rects,
  selectedIndex,
  hoveredIndex,
  pointerInside,
}: {
  rects: readonly ItemRect[];
  selectedIndex: number;
  hoveredIndex: number | null;
  pointerInside: boolean;
}) {
  const shape = useShape();
  const selectedRect = selectedIndex >= 0 ? rects[selectedIndex] : undefined;
  const hoverRect = hoveredIndex === null ? undefined : rects[hoveredIndex];
  const hoveringOther =
    hoverRect !== undefined && hoveredIndex !== selectedIndex;

  return (
    <>
      {selectedRect ? (
        <motion.div
          animate={underlineTarget(selectedRect)}
          className="pointer-events-none absolute rounded-full bg-foreground"
          initial={false}
          transition={spring.moderate}
        />
      ) : null}
      <AnimatePresence>
        {hoveringOther && hoverRect ? (
          <motion.div
            animate={{ ...rectTarget(hoverRect), opacity: 0.4 }}
            className={cn(PILL_CLASS, shape.bg)}
            exit={
              !pointerInside && selectedRect
                ? {
                    ...rectTarget(selectedRect),
                    opacity: 0,
                    transition: {
                      ...spring.moderate,
                      opacity: { duration: 0.06 },
                    },
                  }
                : { opacity: 0, transition: spring.fast.exit }
            }
            initial={
              selectedRect
                ? { ...rectTarget(selectedRect), opacity: 0 }
                : { ...rectTarget(hoverRect), opacity: 0 }
            }
            transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

function dropIndexAt(strip: HTMLElement, clientX: number) {
  const tabs = [...strip.querySelectorAll<HTMLElement>("[data-file-tab]")];
  for (const [index, tab] of tabs.entries()) {
    const rect = tab.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return index;
  }
  return tabs.length;
}

export function CaseRoomTabs({
  idPrefix,
  selectedId,
  onSelect,
  fileTabs,
  onCloseFile,
  onReorderFiles,
  paneName,
  onTransferFile,
  toolbar,
  label = "Case views",
  views = ROOM_VIEWS,
}: CaseRoomTabsProps) {
  const shape = useShape();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [canScroll, setCanScroll] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(stripRef, { axis: "x" });
  const [pointerInside, setPointerInside] = useState(false);
  const openIds = fileTabs.map((tab) => tab.id);
  const viewIndex = views.findIndex((view) => view.id === selectedId);
  const fileIndex = openIds.indexOf(selectedId);
  const selectedIndex =
    viewIndex >= 0 ? viewIndex : fileIndex >= 0 ? views.length + fileIndex : -1;
  const isLit = (index: number) =>
    index === selectedIndex || index === hover.activeIndex;
  const openIdsKey = openIds.join("|");

  useEffect(() => {
    const root = scrollAreaRef.current;
    if (!root) return;
    const viewport = root.querySelector<HTMLElement>(
      "[data-slot='scroll-area-viewport']",
    );
    if (!viewport) return;

    const update = () => {
      setCanScroll(viewport.scrollWidth > viewport.clientWidth + 1);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (stripRef.current) observer.observe(stripRef.current);
    viewport.addEventListener("scroll", update);
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", update);
    };
  }, [openIdsKey]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 items-stretch self-stretch">
      <div
        aria-label={label}
        className={cn(
          "flex min-w-0 flex-1 items-center",
          shape.item,
          dropIndex !== null && "bg-hover",
        )}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDropIndex(null);
          }
        }}
        onDragOver={(event) => {
          if (!isCaseFileTabDrag(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const strip = stripRef.current;
          if (strip) setDropIndex(dropIndexAt(strip, event.clientX));
        }}
        onDrop={(event) => {
          const drag = fileTabDragOf(event);
          if (!drag) return;
          event.preventDefault();
          event.stopPropagation();
          const { id, from } = drag;
          const index = dropIndex ?? openIds.length;
          setDropIndex(null);
          setDraggingId(null);
          activeFileTabDrag = null;
          if (!id) return;
          if (
            paneName &&
            onTransferFile &&
            (from === "main" || from === "side") &&
            from !== paneName
          ) {
            onTransferFile(id, from, index);
            return;
          }
          onReorderFiles(insertOpenTab(openIds, id, index));
        }}
        role="tablist"
      >
        <ScrollArea
          ref={scrollAreaRef}
          className={cn(
            "min-w-0 flex-1 self-stretch [&_[data-slot=scroll-area-scrollbar]]:bottom-0 [&_[data-slot=scroll-area-scrollbar]]:h-0.5 [&_[data-slot=scroll-area-thumb]]:mx-0.5 [&_[data-slot=scroll-area-thumb]]:my-0 [&_[data-slot=scroll-area-thumb]]:mt-auto [&_[data-slot=scroll-area-thumb]]:h-px [&_[data-slot=scroll-area-thumb]]:translate-y-0 [&_[data-slot=scroll-area-scrollbar]:hover_[data-slot=scroll-area-thumb]]:h-0.5",
            !canScroll && "[&_[data-slot=scroll-area-scrollbar]]:hidden",
          )}
          orientation="horizontal"
          viewportClassName={canScroll ? undefined : "overflow-x-auto"}
        >
          <div
            className="relative flex h-7 w-max items-center gap-0.5"
            onMouseLeave={() => {
              setPointerInside(false);
              hover.handlers.onMouseLeave();
            }}
            onMouseMove={(event) => {
              setPointerInside(true);
              hover.handlers.onMouseMove(event);
            }}
            ref={stripRef}
          >
            <TabPills
              hoveredIndex={hover.activeIndex}
              pointerInside={pointerInside}
              rects={hover.itemRects}
              selectedIndex={selectedIndex}
            />
            {views.map((view, index) => (
              <RoomViewTab
                idPrefix={idPrefix}
                index={index}
                key={view.id}
                lit={isLit(index)}
                onSelect={onSelect}
                registerTab={hover.registerItem}
                selected={index === selectedIndex}
                view={view}
              />
            ))}
            {fileTabs.map((tab, index) => {
              const selected = selectedId === tab.id;
              const dragging = draggingId === tab.id;
              const slot = views.length + index;
              return (
                <FileTab
                  aria-controls={`${idPrefix}-panel-${tab.id}`}
                  aria-label={tab.name}
                  aria-selected={selected}
                  className={cn(
                    "cursor-grab active:cursor-grabbing",
                    dragging && "opacity-50",
                    dropIndex === index &&
                      "before:absolute before:inset-y-1 before:-left-px before:w-0.5 before:rounded-full before:bg-foreground",
                  )}
                  data-file-tab={tab.id}
                  draggable
                  id={`${idPrefix}-tab-${tab.id}`}
                  index={slot}
                  key={tab.id}
                  onClick={() => onSelect(tab.id)}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDropIndex(null);
                    activeFileTabDrag = null;
                  }}
                  onDragStart={(event) => {
                    if (
                      event.target instanceof Element &&
                      event.target.closest("button")
                    ) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(FILE_TAB_MIME, tab.id);
                    event.dataTransfer.setData(FILE_PANE_MIME, paneName ?? "");
                    event.dataTransfer.setData("text/plain", tab.id);
                    activeFileTabDrag = { id: tab.id, from: paneName ?? "" };
                    setDraggingId(tab.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(tab.id);
                      return;
                    }
                    if (
                      event.altKey &&
                      (event.key === "ArrowLeft" || event.key === "ArrowRight")
                    ) {
                      event.preventDefault();
                      onReorderFiles(
                        moveOpenTab(
                          openIds,
                          tab.id,
                          event.key === "ArrowLeft" ? -1 : 1,
                        ),
                      );
                    }
                  }}
                  registerTab={hover.registerItem}
                  role="tab"
                  tabIndex={0}
                >
                  <TabLabel
                    className="max-w-[12rem]"
                    lit={isLit(slot)}
                    selected={selected}
                  >
                    {tab.name}
                  </TabLabel>
                  <button
                    aria-label={`Close ${tab.name}`}
                    className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-(--focus-ring)"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseFile(tab.id);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    type="button"
                  >
                    <XIcon aria-hidden="true" className="size-3" />
                  </button>
                </FileTab>
              );
            })}
            {dropIndex === fileTabs.length ? (
              <div
                aria-hidden="true"
                className="h-5 w-0.5 shrink-0 rounded-full bg-foreground"
              />
            ) : null}
          </div>
        </ScrollArea>
      </div>
      {toolbar}
    </div>
  );
}

export type ViewTab<T extends string> = {
  readonly id: T;
  readonly label: string;
  readonly icon: Glyph;
};

/**
 * A row of view tabs drawn exactly like the case room's: icon and label,
 * the selected pill springing between tabs and a lighter hover pill. For
 * pages that switch views under their header.
 */
export function ViewTabs<T extends string>({
  label,
  idPrefix,
  tabs,
  selectedId,
  onSelect,
}: Readonly<{
  label: string;
  idPrefix: string;
  tabs: readonly ViewTab<T>[];
  selectedId: T;
  onSelect: (id: T) => void;
}>) {
  const stripRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(stripRef, { axis: "x" });
  const [pointerInside, setPointerInside] = useState(false);
  const selectedIndex = tabs.findIndex((tab) => tab.id === selectedId);

  return (
    <div
      aria-label={label}
      className="relative flex h-7 w-max items-center gap-0.5"
      onMouseLeave={() => {
        setPointerInside(false);
        hover.handlers.onMouseLeave();
      }}
      onMouseMove={(event) => {
        setPointerInside(true);
        hover.handlers.onMouseMove(event);
      }}
      ref={stripRef}
      role="tablist"
    >
      <TabPills
        hoveredIndex={hover.activeIndex}
        pointerInside={pointerInside}
        rects={hover.itemRects}
        selectedIndex={selectedIndex}
      />
      {tabs.map((tab, index) => (
        <RoomViewTab
          idPrefix={idPrefix}
          index={index}
          key={tab.id}
          lit={index === selectedIndex || index === hover.activeIndex}
          onSelect={(id) => onSelect(id as T)}
          registerTab={hover.registerItem}
          selected={index === selectedIndex}
          view={tab}
        />
      ))}
    </div>
  );
}
