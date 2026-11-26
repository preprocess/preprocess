import { cn } from "@preprocess/ui/lib/utils";
import type { ReactNode } from "react";

import {
  captionClass,
  DiagramFrame,
  elementsOf,
  emptyLayout,
  list,
  textWidth,
  type Layout,
  type Point,
  type Rect,
} from "./render";

// A state machine whose layout is computed: a state's column is its distance
// from the initial state, a transition back to an earlier column is a dashed
// return loop, and `from="*"` is a wildcard row under the diagram.

type StateProps = { id: string; initial?: boolean; final?: boolean };
type TransitionProps = {
  from: string | string[];
  to: string | string[];
  label?: string;
  except?: string | string[];
};

export function State(_: StateProps) {
  return null;
}

export function Transition(_: TransitionProps) {
  return null;
}

const PILL = 32;
const PITCH = 48;
const NARROW_PITCH = 44;

const stateWidth = (id: string) =>
  12 + 6 + 8 + textWidth(id, 13, { mono: true }) + 14;

function StatePill({
  current,
  final,
  id,
}: {
  current: boolean;
  final: boolean;
  id: string;
}) {
  return (
    <div
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-full pr-3.5 pl-3 font-mono text-[13px] leading-4",
        current
          ? "bg-foreground text-background shadow-[0_0_0_4px_var(--diagram-halo)]"
          : final
            ? "bg-[var(--diagram-end)] text-foreground"
            : "bg-[var(--diagram-node)] text-foreground shadow-[inset_0_0_0_1px_var(--diagram-node-ring)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          current
            ? "border-[1.25px] border-background"
            : final
              ? "bg-foreground"
              : "border-[1.25px] border-muted-foreground",
        )}
      />
      <span className="truncate">{id}</span>
    </div>
  );
}

const dot = <span className="size-2.5 rounded-full bg-foreground" />;

type Pair = { from: string; to: string; label?: string };

type Model = {
  states: Map<string, StateProps>;
  columns: string[][];
  column: Map<string, number>;
  forward: Pair[];
  same: Pair[];
  returns: { from: string[]; to: string; label?: string }[];
  wildcards: { except: string[]; to: string; label?: string }[];
  initial?: string;
  highlight?: string;
};

function model(
  states: StateProps[],
  transitions: TransitionProps[],
  highlight?: string,
): Model {
  const initial = states.find((state) => state.initial)?.id ?? states[0]?.id;
  const pairs: Pair[] = transitions.flatMap((transition) =>
    transition.from === "*"
      ? []
      : list(transition.from).flatMap((from) =>
          list(transition.to).map((to) => ({
            from,
            to,
            label: transition.label,
          })),
        ),
  );

  // Columns: the distance from the initial state.
  const column = new Map<string, number>();
  if (initial) column.set(initial, 0);
  const queue = initial ? [initial] : [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const pair of pairs)
      if (pair.from === id && !column.has(pair.to)) {
        column.set(pair.to, column.get(id)! + 1);
        queue.push(pair.to);
      }
  }
  const wildcardTargets = new Set(
    transitions
      .filter((transition) => transition.from === "*")
      .flatMap((transition) => list(transition.to)),
  );
  const last = Math.max(-1, ...column.values());
  for (const state of states)
    if (!column.has(state.id) && !wildcardTargets.has(state.id))
      column.set(state.id, last + 1);

  const columns: string[][] = [];
  for (const state of states) {
    const index = column.get(state.id);
    if (index !== undefined) (columns[index] ??= []).push(state.id);
  }

  const at = (id: string) => column.get(id) ?? 0;
  const returns: Model["returns"] = [];
  for (const transition of transitions) {
    if (transition.from === "*") continue;
    for (const to of list(transition.to)) {
      const from = list(transition.from).filter((id) => at(id) > at(to));
      if (from.length > 0) returns.push({ from, to, label: transition.label });
    }
  }

  return {
    states: new Map(states.map((state) => [state.id, state])),
    columns: columns.filter(Boolean),
    column,
    forward: pairs.filter((pair) => at(pair.to) > at(pair.from)),
    same: pairs.filter(
      (pair) => at(pair.to) === at(pair.from) && pair.from !== pair.to,
    ),
    returns,
    wildcards: transitions
      .filter((transition) => transition.from === "*")
      .flatMap((transition) =>
        list(transition.to).map((to) => ({
          except: list(transition.except),
          to,
          label: transition.label,
        })),
      ),
    initial,
    highlight,
  };
}

const wildcardText = (except: string[]) =>
  except.length > 0 ? `any status but ${except.join(", ")}` : "any status";

const right = (rect: Rect) => rect.x + rect.w;
const bottom = (rect: Rect) => rect.y + rect.h;
const middle = (rect: Rect) => rect.y + rect.h / 2;
const center = (rect: Rect) => rect.x + rect.w / 2;

function place(layout: Layout, m: Model, rects: Map<string, Rect>) {
  for (const [id, rect] of rects) {
    const state = m.states.get(id);
    layout.nodes.push({
      rect,
      node: (
        <StatePill
          current={id === m.highlight}
          final={!!state?.final}
          id={id}
        />
      ),
    });
  }
}

function addWildcardPill(layout: Layout, rect: Rect, text: string) {
  layout.outlines.push({ ...rect, radius: rect.h / 2 });
  layout.nodes.push({
    rect,
    node: (
      <span
        className={cn(captionClass, "flex w-full items-center justify-center")}
      >
        {text}
      </span>
    ),
  });
}

// A group around the states a return loop leaves from, wide enough for the
// elbows between them.
function groupRect(sources: Rect[], elbow: number | undefined): Rect {
  const x = Math.min(...sources.map((rect) => rect.x)) - 12;
  const y = Math.min(...sources.map((rect) => rect.y)) - 12;
  const r = Math.max(elbow ?? 0, ...sources.map(right)) + 12;
  const b = Math.max(...sources.map(bottom)) + 12;
  return { x, y, w: r - x, h: b - y };
}

function wide(m: Model): Layout {
  const layout = emptyLayout();
  const widths = m.columns.map((ids) => Math.max(...ids.map(stateWidth)));
  const hasElbow = (index: number) =>
    m.same.some((pair) => m.column.get(pair.from) === index);
  const grouped = m.returns.some((loop) => loop.from.length > 1);
  const columnX: number[] = [];
  let x = m.initial ? 34 : 0;
  m.columns.forEach((ids, index) => {
    columnX.push(x);
    const fan = m.forward.some(
      (pair) =>
        m.column.get(pair.from) === index &&
        m.forward.filter((other) => other.from === pair.from).length > 1,
    );
    x += widths[index] + (hasElbow(index) ? 44 : 0) + (fan ? 72 : 56);
  });
  const heights = m.columns.map((ids) => ids.length * PITCH - (PITCH - PILL));
  const tallest = Math.max(...heights);
  const top = grouped ? 12 : 0;

  const rects = new Map<string, Rect>();
  m.columns.forEach((ids, index) =>
    ids.forEach((id, row) =>
      rects.set(id, {
        x: columnX[index],
        y: top + (tallest - heights[index]) / 2 + row * PITCH,
        w: widths[index],
        h: PILL,
      }),
    ),
  );
  const rect = (id: string) => rects.get(id)!;
  const current = (to: string) => to === m.highlight;
  let extent = Math.max(...[...rects.values()].map(right));
  let floor = top + tallest + top;

  if (m.initial) {
    const first = rect(m.initial);
    layout.nodes.push({
      rect: { x: 0, y: middle(first) - 5, w: 10, h: 10 },
      node: dot,
    });
    layout.edges.push({
      points: [
        [10, middle(first)],
        [first.x, middle(first)],
      ],
      current: current(m.initial),
    });
  }

  for (const pair of m.forward) {
    const s = rect(pair.from);
    const t = rect(pair.to);
    const trunk = right(s) + Math.min(24, (t.x - right(s)) / 2);
    layout.edges.push({
      points: [
        [right(s), middle(s)],
        [trunk, middle(s)],
        [trunk, middle(t)],
        [t.x, middle(t)],
      ],
      current: current(pair.to),
    });
  }

  const elbowX = (id: string) => {
    const index = m.column.get(id)!;
    return columnX[index] + widths[index] + 20;
  };
  for (const pair of m.same) {
    const s = rect(pair.from);
    const t = rect(pair.to);
    const elbow = elbowX(pair.from);
    layout.edges.push({
      points: [
        [right(s), middle(s)],
        [elbow, middle(s)],
        [elbow, middle(t)],
        [right(t), middle(t)],
      ],
      current: current(pair.to),
    });
  }

  for (const loop of m.returns) {
    const sources = loop.from.map(rect);
    const t = rect(loop.to);
    let start: Point;
    if (sources.length > 1) {
      const elbows = m.same.filter(
        (pair) => loop.from.includes(pair.from) && loop.from.includes(pair.to),
      );
      const group = groupRect(
        sources,
        elbows.length > 0 ? elbowX(elbows[0].from) : undefined,
      );
      layout.outlines.push({ ...group, radius: 22 });
      extent = Math.max(extent, right(group));
      start = [center(group), bottom(group)];
    } else start = [center(sources[0]), bottom(sources[0])];
    const y = Math.max(start[1], bottom(t)) + 36;
    layout.edges.push({
      points: [start, [start[0], y], [center(t), y], [center(t), bottom(t)]],
      dashed: true,
      current: current(loop.to),
    });
    if (loop.label)
      layout.labels.push({
        text: loop.label,
        x: (start[0] + center(t)) / 2,
        y,
        anchor: "center",
        onLine: true,
      });
    floor = Math.max(floor, y + 8);
  }

  place(layout, m, rects);

  let height = floor;
  if (m.wildcards.length > 0) {
    const hairline = floor + 24;
    layout.hairlines.push(hairline);
    let rowY = hairline + 24;
    for (const wildcard of m.wildcards) {
      const text = wildcardText(wildcard.except);
      const pillW = textWidth(text, 12) + 48;
      const gap = Math.max(
        72,
        wildcard.label ? textWidth(wildcard.label, 12) + 48 : 0,
      );
      const targetW = stateWidth(wildcard.to);
      const rowW = pillW + gap + targetW;
      extent = Math.max(extent, rowW);
      const rowX = Math.max(0, (extent - rowW) / 2);
      const pill = { x: rowX, y: rowY, w: pillW, h: PILL };
      const target = { x: rowX + pillW + gap, y: rowY, w: targetW, h: PILL };
      addWildcardPill(layout, pill, text);
      layout.edges.push({
        points: [
          [right(pill), middle(pill)],
          [target.x, middle(pill)],
        ],
        current: current(wildcard.to),
      });
      if (wildcard.label)
        layout.labels.push({
          text: wildcard.label,
          x: right(pill) + gap / 2,
          y: middle(pill) - 16,
          anchor: "center",
        });
      place(layout, m, new Map([[wildcard.to, target]]));
      rowY += PITCH;
    }
    height = rowY - (PITCH - PILL);
  }

  layout.width = extent;
  layout.height = height;
  return layout;
}

// Phones: the chain runs down a lane, a fan becomes an indented list on a
// left trunk, the return loop runs up the right side, and the wildcard row
// stacks.
function narrow(m: Model): Layout {
  const layout = emptyLayout();
  const lane = 40;
  const indent = 48;
  const rects = new Map<string, Rect>();
  const current = (to: string) => to === m.highlight;
  let y = 0;
  let previous: Rect | undefined;

  if (m.initial) {
    previous = { x: lane - 5, y: 0, w: 10, h: 10 };
    layout.nodes.push({ rect: previous, node: dot });
    y = 10 + 24;
  }

  const listWidth = (ids: string[]) => Math.max(...ids.map(stateWidth));
  m.columns.forEach((ids) => {
    if (ids.length === 1) {
      const id = ids[0];
      const rect = { x: 0, y, w: stateWidth(id), h: PILL };
      rects.set(id, rect);
      if (previous)
        layout.edges.push({
          points: [
            [lane, bottom(previous)],
            [lane, rect.y],
          ],
          current: current(id),
        });
      previous = rect;
      y = bottom(rect) + 32;
      return;
    }
    const w = listWidth(ids);
    const listTop = y + 8;
    ids.forEach((id, row) =>
      rects.set(id, { x: indent, y: listTop + row * NARROW_PITCH, w, h: PILL }),
    );
    y = listTop + ids.length * NARROW_PITCH - (NARROW_PITCH - PILL) + 32;
  });
  const rect = (id: string) => rects.get(id)!;

  // Forward edges into an indented list come down a trunk on the source's
  // left; a chain step was drawn on the lane above.
  for (const pair of m.forward) {
    const s = rect(pair.from);
    const t = rect(pair.to);
    if (t.x === 0) continue;
    const trunk = s.x + 24;
    layout.edges.push({
      points: [
        [trunk, bottom(s)],
        [trunk, middle(t)],
        [t.x, middle(t)],
      ],
      current: current(pair.to),
    });
  }

  const elbowX = (id: string) => right(rect(id)) + 20;
  for (const pair of m.same) {
    const s = rect(pair.from);
    const t = rect(pair.to);
    const elbow = elbowX(pair.from);
    layout.edges.push({
      points: [
        [right(s), middle(s)],
        [elbow, middle(s)],
        [elbow, middle(t)],
        [right(t), middle(t)],
      ],
      current: current(pair.to),
    });
  }

  let extent = Math.max(...[...rects.values()].map(right));
  let floor = Math.max(...[...rects.values()].map(bottom));
  for (const loop of m.returns) {
    const sources = loop.from.map(rect);
    const t = rect(loop.to);
    let from: Rect;
    if (sources.length > 1) {
      const elbows = m.same.filter(
        (pair) => loop.from.includes(pair.from) && loop.from.includes(pair.to),
      );
      from = groupRect(
        sources,
        elbows.length > 0 ? elbowX(elbows[0].from) : undefined,
      );
      layout.outlines.push({ ...from, radius: 22 });
      floor = Math.max(floor, bottom(from));
    } else from = sources[0]!;
    const x = right(from) + 36;
    const start: Point = [right(from), middle(from)];
    layout.edges.push({
      points: [start, [x, start[1]], [x, middle(t)], [right(t), middle(t)]],
      dashed: true,
      current: current(loop.to),
    });
    if (loop.label) {
      layout.labels.push({
        text: loop.label,
        x: x + 10,
        y: (start[1] + middle(t)) / 2,
        anchor: "left",
      });
      extent = Math.max(extent, x + 10 + textWidth(loop.label, 12));
    } else extent = Math.max(extent, x);
  }

  place(layout, m, rects);

  let height = floor;
  if (m.wildcards.length > 0) {
    const hairline = floor + 28;
    layout.hairlines.push(hairline);
    let rowY = hairline + 24;
    for (const wildcard of m.wildcards) {
      const text = wildcardText(wildcard.except);
      const pill = { x: 0, y: rowY, w: textWidth(text, 12) + 48, h: PILL };
      const target = {
        x: indent,
        y: bottom(pill) + 40,
        w: stateWidth(wildcard.to),
        h: PILL,
      };
      addWildcardPill(layout, pill, text);
      layout.edges.push({
        points: [
          [24, bottom(pill)],
          [24, middle(target)],
          [target.x, middle(target)],
        ],
        current: current(wildcard.to),
      });
      if (wildcard.label)
        layout.labels.push({
          text: wildcard.label,
          x: 36,
          y: bottom(pill) + 18,
          anchor: "left",
        });
      place(layout, m, new Map([[wildcard.to, target]]));
      extent = Math.max(extent, right(pill), right(target));
      rowY = bottom(target) + 24;
      height = bottom(target);
    }
  }

  layout.width = extent;
  layout.height = height;
  return layout;
}

export function StateMachine({
  caption,
  children,
  highlight,
  label,
}: {
  caption?: ReactNode;
  children: ReactNode;
  highlight?: string;
  label?: string;
}) {
  const states = elementsOf(children, State).map((element) => element.props);
  const transitions = elementsOf(children, Transition).map(
    (element) => element.props,
  );
  const m = model(states, transitions, highlight);
  const description = transitions.map((transition) => {
    const from =
      transition.from === "*"
        ? wildcardText(list(transition.except))
        : list(transition.from).join(", ");
    const to = list(transition.to).join(", ");
    return `${from} → ${to}${transition.label ? `: ${transition.label}` : ""}`;
  });
  return (
    <DiagramFrame
      caption={caption}
      description={description}
      label={label}
      narrow={narrow(m)}
      wide={wide(m)}
    />
  );
}
