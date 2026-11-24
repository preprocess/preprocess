import { useEffect, useRef, type CSSProperties } from "react";

import briefcase from "./hairline/briefcase";
import espresso from "./hairline/espresso";
import flashlight from "./hairline/flashlight";
import funnel from "./hairline/funnel";
import hourglass from "./hairline/hourglass";
import { inject, mk } from "./hairline/kernel";
import mailbox from "./hairline/mailbox";
import robot from "./hairline/robot";
import scale from "./hairline/scale";
import tag from "./hairline/tag";
import tincans from "./hairline/tincans";

/**
 * Empty-state illustrations: Hairline isometric line figures that answer the
 * pointer. Each object is lit whole in the bright tone, its supports quieter,
 * over the pane colour. The figures and the kernel are vendored in
 * `./hairline`; this file only mounts them.
 */

type Figure = {
  name: string;
  /** The figure's own number at low, default and high intensity. */
  range: readonly number[];
  mount: (
    host: {
      stage: HTMLElement;
      svg: SVGSVGElement;
      read: { textContent: string };
    },
    value: number,
  ) => { set: (value: number) => void; destroy: () => void };
};

// Tones are the foreground mixed into the pane colour, so overlaps never darken.
const mix = (percent: number) =>
  `color-mix(in oklab, var(--foreground) ${percent}%, var(--surface-2))`;
const TONES = {
  "--hairline-plate": "var(--surface-2)",
  "--hairline-hi": mix(68),
  "--hairline-edge": mix(42),
  "--hairline-mid": mix(30),
  "--hairline-lo": mix(18),
  "--hairline-stroke": "1.4",
} as CSSProperties;

function Art({ figure }: Readonly<{ figure: Figure }>) {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    inject(document);
    const svg = mk(
      "svg",
      { viewBox: "0 0 400 320", "aria-hidden": "true" },
      stage,
    );
    // The figure writes its read-out here; empty states have no corner caption.
    const handle = figure.mount(
      { stage, svg, read: { textContent: "" } },
      figure.range[1],
    );
    return () => {
      handle.destroy();
      svg.remove();
    };
  }, [figure]);

  // The kernel's stylesheet keys off data-hairline and holds the 5:4 box before mount.
  return (
    <div
      aria-hidden="true"
      className="w-48"
      data-hairline={figure.name}
      ref={stageRef}
      style={TONES}
    />
  );
}

/** No notifications: a mailbox, flag down; its door drops open on a bare floor. */
export function MailboxArt() {
  return <Art figure={mailbox} />;
}

/** Caught up: a drained espresso that tips to show its bare bottom. */
export function EspressoArt() {
  return <Art figure={espresso} />;
}

/** No cases: a briefcase whose lid lifts on an empty pocket. */
export function BriefcaseArt() {
  return <Art figure={briefcase} />;
}

/** Nothing matches: a flashlight whose beam sweeps bare boards. */
export function NoMatchArt() {
  return <Art figure={flashlight} />;
}

/** No agents: an idle robot that turns its head toward the pointer. */
export function RobotArt() {
  return <Art figure={robot} />;
}

/** No input: a funnel over an empty beaker, tipping to show its bare cone. */
export function FunnelArt() {
  return <Art figure={funnel} />;
}

/** No messages: two tin cans on a slack string that pulls taut. */
export function TinCansArt() {
  return <Art figure={tincans} />;
}

/** No review: a balance whose empty pans tip under the pointer. */
export function ScaleArt() {
  return <Art figure={scale} />;
}

/** No events: an hourglass with none of its sand fallen. */
export function HourglassArt() {
  return <Art figure={hourglass} />;
}

/** No details: a blank luggage tag that swings and turns. */
export function LuggageTagArt() {
  return <Art figure={tag} />;
}
