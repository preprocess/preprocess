import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import * as icons from "@preprocess/ui/lib/icons";
import { cn } from "@preprocess/ui/lib/utils";
import {
  Children,
  isValidElement,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";

import advances from "./inter-advances.json";

// The shared layout of <StateMachine> and <Flow>: sizes from font metrics
// rather than the DOM, orthogonal edges with rounded corners, and a figure
// that holds a wide and a narrow layout and shows one by container width.
// Nothing here uses state or effects.

export type Point = [number, number];
export type Rect = { x: number; y: number; w: number; h: number };

const inter = advances as unknown as Record<
  "400" | "500",
  Record<string, number>
> & { fallback: number };

// Inter from a per-character advance table taken from
// public/fonts/InterVariable.ttf; mono labels are 0.6em a character. Two
// pixels of slack keep a label that measures exactly on one line.
export function textWidth(
  text: string,
  size: number,
  { mono = false, weight = 400 }: { mono?: boolean; weight?: 400 | 500 } = {},
) {
  if (mono) return Math.ceil(text.length * 0.6 * size);
  let em = 0;
  for (const char of text) em += inter[weight][char] ?? inter.fallback;
  return Math.ceil(em * size) + 2;
}

export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node))
    return textOf(node.props.children);
  return "";
}

export const clean = (text: string) => text.replace(/\s+/g, " ").trim();

// The marker elements of a diagram (<State>, <Edge>, …) among its children.
export function elementsOf<P>(
  children: ReactNode,
  type: ComponentType<P>,
): ReactElement<P>[] {
  return Children.toArray(children).filter(
    (child): child is ReactElement<P> =>
      isValidElement(child) && child.type === type,
  );
}

export const list = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

// A node's icon by name, from the kit's icon module: "box" is Box.
export function iconFor(name?: string) {
  if (!name) return undefined;
  const key = name
    .split(/[-_\s]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  const icon = (icons as Record<string, unknown>)[key];
  return typeof icon === "function"
    ? (icon as ComponentType<{
        size?: number;
        strokeWidth?: number;
        className?: string;
      }>)
    : undefined;
}

// An orthogonal polyline with 8px rounded corners.
export function roundedPath(input: Point[], radius = 8) {
  const points = input.filter(
    (point, index) =>
      index === 0 ||
      point[0] !== input[index - 1][0] ||
      point[1] !== input[index - 1][1],
  );
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let index = 1; index < points.length - 1; index++) {
    const [px, py] = points[index - 1];
    const [x, y] = points[index];
    const [nx, ny] = points[index + 1];
    const before = Math.hypot(x - px, y - py);
    const after = Math.hypot(nx - x, ny - y);
    const r = Math.min(radius, before / 2, after / 2);
    const ax = x - ((x - px) / before) * r;
    const ay = y - ((y - py) / before) * r;
    const bx = x + ((nx - x) / after) * r;
    const by = y + ((ny - y) / after) * r;
    d += ` L${ax} ${ay} Q${x} ${y} ${bx} ${by}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last[0]} ${last[1]}`;
}

// An open arrowhead, 6px long at ±35°, pointing along the last segment.
export function arrowHead(points: Point[]) {
  const [tx, ty] = points[points.length - 1];
  let index = points.length - 2;
  while (index > 0 && points[index][0] === tx && points[index][1] === ty)
    index--;
  const [px, py] = points[index];
  const length = Math.hypot(tx - px, ty - py) || 1;
  const ux = (px - tx) / length;
  const uy = (py - ty) / length;
  const angle = (35 * Math.PI) / 180;
  const arm = (sign: number) => {
    const cos = Math.cos(angle * sign);
    const sin = Math.sin(angle * sign);
    return [tx + (ux * cos - uy * sin) * 6, ty + (ux * sin + uy * cos) * 6];
  };
  const [ax, ay] = arm(1);
  const [bx, by] = arm(-1);
  return `M${ax} ${ay} L${tx} ${ty} L${bx} ${by}`;
}

export type Edge = {
  points: Point[];
  dashed?: boolean;
  current?: boolean;
};

export type Label = {
  text: string;
  x: number;
  y: number;
  // Which point of the label sits at (x, y): its middle, or the middle of
  // its left or right side.
  anchor: "center" | "left" | "right";
  // On a dashed loop the label covers the line.
  onLine?: boolean;
};

export type Outline = Rect & { radius: number };

export type Layout = {
  width: number;
  height: number;
  edges: Edge[];
  labels: Label[];
  // Dashed outlines: groups, actor and wildcard pills.
  outlines: Outline[];
  hairlines: number[];
  nodes: { rect: Rect; node: ReactNode }[];
};

export const emptyLayout = (): Layout => ({
  width: 0,
  height: 0,
  edges: [],
  labels: [],
  outlines: [],
  hairlines: [],
  nodes: [],
});

export const captionClass = "text-[12px] leading-4 text-muted-foreground";

function Canvas({
  className,
  description,
  layout,
}: {
  className: string;
  description: string[];
  layout: Layout;
}) {
  return (
    <div className={className}>
      <ScrollArea orientation="horizontal" viewportClassName="scroll-fade">
        <div
          className="relative mx-auto"
          style={{ width: layout.width, height: layout.height }}
        >
          <svg
            aria-hidden
            className="absolute inset-0 overflow-visible"
            fill="none"
            height={layout.height}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={layout.width}
          >
            {layout.hairlines.map((y, index) => (
              <line
                key={`h${index}`}
                stroke="var(--border)"
                x1={0}
                x2={layout.width}
                y1={y + 0.5}
                y2={y + 0.5}
              />
            ))}
            {layout.outlines.map((outline, index) => (
              <rect
                height={outline.h - 1}
                key={`o${index}`}
                rx={outline.radius}
                stroke="var(--diagram-line)"
                strokeDasharray="4 4"
                width={outline.w - 1}
                x={outline.x + 0.5}
                y={outline.y + 0.5}
              />
            ))}
            {layout.edges.map((edge, index) => (
              <g key={`e${index}`}>
                <path
                  d={roundedPath(edge.points)}
                  stroke={
                    edge.current ? "var(--foreground)" : "var(--diagram-line)"
                  }
                  strokeDasharray={edge.dashed ? "4 4" : undefined}
                  strokeWidth={edge.current ? 1.5 : 1}
                />
                <path
                  d={arrowHead(edge.points)}
                  stroke={
                    edge.current ? "var(--foreground)" : "var(--diagram-arrow)"
                  }
                  strokeWidth={edge.current ? 1.5 : 1.15}
                />
              </g>
            ))}
          </svg>
          {layout.labels.map((label, index) => (
            <span
              aria-hidden
              className={cn(
                captionClass,
                "absolute -translate-y-1/2 whitespace-nowrap",
                label.anchor === "center" && "-translate-x-1/2",
                label.anchor === "right" && "-translate-x-full",
                label.onLine && "bg-surface-1 px-1.5",
              )}
              key={`l${index}`}
              style={{ left: label.x, top: label.y }}
            >
              {label.text}
            </span>
          ))}
          {layout.nodes.map(({ rect, node }, index) => (
            <div
              className="absolute flex"
              key={`n${index}`}
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
              }}
            >
              {node}
            </div>
          ))}
        </div>
      </ScrollArea>
      <ul className="sr-only">
        {description.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

// Room inside the frame for each layout: the reading column at 1440 and at
// 390, less the frame's padding. The narrow layout shows below 560px.
export const WIDE_SPACE = 632 - 48;
export const NARROW_SPACE = 350 - 32;

// The frame: the code block's well, a wide and a narrow layout switched by a
// container query, and an optional caption under a hairline.
export function DiagramFrame({
  caption,
  description,
  label,
  narrow,
  wide,
}: {
  caption?: ReactNode;
  description: string[];
  label?: string;
  narrow: Layout;
  wide: Layout;
}) {
  return (
    <figure
      aria-label={label}
      className="diagram not-typeset @container my-6 overflow-hidden rounded-2xl bg-surface-1 shadow-[inset_0_0_0_1px_var(--border)]"
      role="group"
    >
      <Canvas
        className="px-6 py-7 @max-[560px]:hidden"
        description={description}
        layout={wide}
      />
      <Canvas
        className="hidden px-4 py-5 @max-[560px]:block"
        description={description}
        layout={narrow}
      />
      {caption ? (
        <figcaption
          className={cn(captionClass, "border-t border-border px-4 py-2.5")}
        >
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
