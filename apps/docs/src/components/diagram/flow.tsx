import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { cn } from "@preprocess/ui/lib/utils";
import type { ReactNode } from "react";

import {
  captionClass,
  clean,
  DiagramFrame,
  elementsOf,
  emptyLayout,
  iconFor,
  NARROW_SPACE,
  textOf,
  textWidth,
  WIDE_SPACE,
  type Layout,
  type Point,
  type Rect,
} from "./render";

// An architecture flow whose nodes sit on a small grid: `at="col row"`, and
// `narrow="col row"` where the phone grid differs.

type Kind = "system" | "step" | "actor" | "end";

type NodeProps = {
  id: string;
  kind?: Kind;
  icon?: string;
  at: string;
  narrow?: string;
  detail?: string;
  children?: ReactNode;
};

type EdgeProps = { from: string; to: string; label?: string };

export function Node(_: NodeProps) {
  return null;
}

export function Edge(_: EdgeProps) {
  return null;
}

type Item = {
  id: string;
  kind: Kind;
  title: string;
  detail?: string;
  icon?: string;
  col: number;
  row: number;
};

const heights: Record<Kind, number> = {
  system: 56,
  step: 32,
  actor: 40,
  end: 40,
};
const ICON = 16 + 10;
const MIN_WITH_ICON = 140;

function naturalWidth(item: Item) {
  const icon = item.icon ? ICON : 0;
  const width =
    item.kind === "system"
      ? 12 +
        icon +
        Math.max(
          textWidth(item.title, 13, { weight: 500 }),
          item.detail ? textWidth(item.detail, 12) : 0,
        ) +
        12
      : item.kind === "step"
        ? 12 + icon + textWidth(item.title, 13) + 14
        : 16 + icon + textWidth(item.title, 13) + 16;
  return item.icon ? Math.max(width, MIN_WITH_ICON) : width;
}

// Cards in a column share its width; actor and end pills keep their own.
const isCard = (item: Item) => item.kind === "system" || item.kind === "step";

function FlowNode({ item, width }: { item: Item; width: number }) {
  const Icon = width >= MIN_WITH_ICON ? iconFor(item.icon) : undefined;
  const title = (
    <span
      className="text-[13px] leading-[18px] text-foreground"
      style={{
        fontVariationSettings:
          item.kind === "system" ? fontWeights.medium : fontWeights.normal,
      }}
    >
      {item.title}
    </span>
  );
  const icon = Icon ? (
    <Icon
      className={cn(
        "shrink-0",
        item.kind === "end" ? "text-foreground" : "text-muted-foreground",
      )}
      size={16}
      strokeWidth={1.15}
    />
  ) : null;
  if (item.kind === "system")
    return (
      <div className="flex size-full items-center gap-2.5 rounded-[14px] bg-[var(--diagram-node)] px-3 shadow-[inset_0_0_0_1px_var(--diagram-node-ring)]">
        {icon}
        <span className="flex min-w-0 flex-col">
          {title}
          {item.detail ? (
            <span className={captionClass}>{item.detail}</span>
          ) : null}
        </span>
      </div>
    );
  return (
    <div
      className={cn(
        "flex size-full items-center gap-2.5 rounded-[20px]",
        item.kind === "step"
          ? "rounded-full bg-[var(--diagram-node)] pr-3.5 pl-3 shadow-[inset_0_0_0_1px_var(--diagram-node-ring)]"
          : "px-4",
        item.kind === "end" && "bg-[var(--diagram-end)]",
      )}
    >
      {icon}
      {title}
    </div>
  );
}

const right = (rect: Rect) => rect.x + rect.w;
const bottom = (rect: Rect) => rect.y + rect.h;
const middle = (rect: Rect) => rect.y + rect.h / 2;
const center = (rect: Rect) => rect.x + rect.w / 2;

// Shrinks columns from the right until the total fits, each no narrower
// than a label without its icon needs, so the main column keeps its size.
function fit(widths: number[], space: number) {
  const fitted = [...widths];
  let over = fitted.reduce((sum, width) => sum + width, 0) - space;
  for (let col = fitted.length - 1; col >= 0 && over > 0; col--) {
    const cut = Math.min(over, Math.max(0, fitted[col] - 96));
    fitted[col] = fitted[col] - cut;
    over -= cut;
  }
  return fitted;
}

function layoutFlow(items: Item[], edges: EdgeProps[], space: number): Layout {
  const layout = emptyLayout();
  const byId = new Map(items.map((item) => [item.id, item]));
  const columns = Math.max(...items.map((item) => item.col)) + 1;
  const rows = Math.max(...items.map((item) => item.row)) + 1;
  const natural = new Map(items.map((item) => [item.id, naturalWidth(item)]));

  let widths = Array.from({ length: columns }, (_, col) => {
    const inColumn = items.filter((item) => item.col === col);
    const cards = inColumn.filter(isCard);
    const sized =
      cards.length > 0
        ? cards
        : inColumn.filter((item) => item.kind !== "actor");
    return Math.max(0, ...sized.map((item) => natural.get(item.id)!));
  });

  // A gap needs room for the label of a horizontal edge across it, and for
  // an end or actor pill that runs past its column's cards into it.
  const labelNeed = Array.from({ length: columns - 1 }, (_, col) =>
    Math.max(
      0,
      ...edges.map((edge) => {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b || !edge.label || a.row !== b.row) return 0;
        return Math.min(a.col, b.col) === col && Math.abs(a.col - b.col) === 1
          ? textWidth(edge.label, 12) + 12
          : 0;
      }),
      ...items
        .filter(
          (item) =>
            item.col === col &&
            !isCard(item) &&
            items.some(
              (other) => other.row === item.row && other.col === col + 1,
            ),
        )
        .map((item) => natural.get(item.id)! - widths[col] + 16),
    ),
  );
  let gaps = labelNeed.map((need) => (need > 0 ? Math.max(64, need) : 56));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  if (sum(widths) + sum(gaps) > space) {
    gaps = labelNeed.map((need) => Math.max(32, need));
    widths = fit(widths, space - sum(gaps));
  }
  const columnX = widths.map(
    (_, col) => sum(widths.slice(0, col)) + sum(gaps.slice(0, col)),
  );
  const total = sum(widths) + sum(gaps);

  // Node widths, then the rows they need.
  const width = new Map<string, number>();
  for (const item of items) {
    const x = columnX[item.col];
    if (isCard(item)) {
      width.set(item.id, widths[item.col]);
      continue;
    }
    const next = items
      .filter((other) => other.row === item.row && other.col > item.col)
      .map((other) => columnX[other.col] - 16);
    const limit = Math.min(total, ...next) - x;
    width.set(
      item.id,
      Math.min(natural.get(item.id)!, Math.max(limit, widths[item.col])),
    );
  }
  const height = (item: Item) =>
    width.get(item.id)! < natural.get(item.id)! && item.kind !== "system"
      ? 56
      : heights[item.kind];
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(0, ...items.filter((item) => item.row === row).map(height)),
  );
  const rowGaps = Array.from({ length: rows - 1 }, (_, row) =>
    edges.some((edge) => {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      return (
        !!edge.label &&
        !!a &&
        !!b &&
        a.col === b.col &&
        Math.min(a.row, b.row) === row
      );
    })
      ? 64
      : 48,
  );
  const rowY = rowHeights.map(
    (_, row) => sum(rowHeights.slice(0, row)) + sum(rowGaps.slice(0, row)),
  );

  const rects = new Map<string, Rect>();
  for (const item of items) {
    const h = height(item);
    const rect = {
      x: columnX[item.col],
      y: rowY[item.row] + (rowHeights[item.row] - h) / 2,
      w: width.get(item.id)!,
      h,
    };
    rects.set(item.id, rect);
    if (item.kind === "actor") layout.outlines.push({ ...rect, radius: 20 });
    layout.nodes.push({
      rect,
      node: <FlowNode item={item} width={rect.w} />,
    });
  }

  edges.forEach((edge, index) => {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) return;
    const ra = rects.get(a.id)!;
    const rb = rects.get(b.id)!;
    const twin = edges.findIndex(
      (other) => other.from === edge.to && other.to === edge.from,
    );
    const offset = twin === -1 ? 0 : twin > index ? -8 : 8;
    let points: Point[];
    if (a.row === b.row) {
      const forward = b.col > a.col;
      const y = middle(ra) + offset;
      points = [
        [forward ? right(ra) : ra.x, y],
        [forward ? rb.x : right(rb), y],
      ];
      if (edge.label)
        layout.labels.push({
          text: edge.label,
          x: (points[0][0] + points[1][0]) / 2,
          y: offset > 0 ? y + 12 : y - 12,
          anchor: "center",
        });
    } else if (a.col === b.col) {
      const down = b.row > a.row;
      const x =
        (Math.max(ra.x, rb.x) + Math.min(right(ra), right(rb))) / 2 + offset;
      points = [
        [x, down ? bottom(ra) : ra.y],
        [x, down ? rb.y : bottom(rb)],
      ];
      if (edge.label)
        layout.labels.push({
          text: edge.label,
          x: offset < 0 ? x - 10 : x + 10,
          y: (points[0][1] + points[1][1]) / 2,
          anchor: offset < 0 ? "right" : "left",
        });
    } else {
      const forward = b.col > a.col;
      const down = b.row > a.row;
      points = [
        [forward ? right(ra) : ra.x, middle(ra)],
        [center(rb), middle(ra)],
        [center(rb), down ? rb.y : bottom(rb)],
      ];
      if (edge.label)
        layout.labels.push({
          text: edge.label,
          x: (points[0][0] + center(rb)) / 2,
          y: middle(ra) - 12,
          anchor: "center",
        });
    }
    layout.edges.push({ points });
  });

  layout.width = Math.max(total, ...[...rects.values()].map(right));
  layout.height = Math.max(...[...rects.values()].map(bottom));
  return layout;
}

const cell = (value: string) => {
  const [col = 0, row = 0] = value.trim().split(/\s+/).map(Number);
  return { col, row };
};

export function Flow({
  caption,
  children,
  label,
}: {
  caption?: ReactNode;
  children: ReactNode;
  label?: string;
}) {
  const nodes = elementsOf(children, Node).map((element) => element.props);
  const edges = elementsOf(children, Edge).map((element) => element.props);
  const items = (narrow: boolean): Item[] =>
    nodes.map((node) => ({
      id: node.id,
      kind: node.kind ?? "system",
      title: clean(textOf(node.children)),
      detail: node.detail,
      icon: node.icon,
      ...cell(narrow && node.narrow ? node.narrow : node.at),
    }));
  const title = (id: string) =>
    clean(textOf(nodes.find((node) => node.id === id)?.children)) || id;
  const description = edges.map(
    (edge) =>
      `${title(edge.from)} → ${title(edge.to)}${edge.label ? `: ${edge.label}` : ""}`,
  );
  return (
    <DiagramFrame
      caption={caption}
      description={description}
      label={label ?? (typeof caption === "string" ? caption : undefined)}
      narrow={layoutFlow(items(true), edges, NARROW_SPACE)}
      wide={layoutFlow(items(false), edges, WIDE_SPACE)}
    />
  );
}
