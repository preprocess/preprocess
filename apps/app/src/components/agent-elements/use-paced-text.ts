import type { UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";

/** Flue's durable mid-block flush. Fat dumps still finish inside this window. */
export const FLUE_CANONICAL_FLUSH_MS = 1000;

/**
 * Floor so a thin flush does not crawl to fill the second.
 * ~20ms/word at 5 chars/word — same cadence as Think's smoothStream.
 */
export const MIN_REVEAL_CHARS_PER_SEC = 250;

/** How long to drip `extraChars` — never slower than the floor, never past the window. */
export function revealDurationMs(
  extraChars: number,
  windowMs = FLUE_CANONICAL_FLUSH_MS,
  minCharsPerSec = MIN_REVEAL_CHARS_PER_SEC,
): number {
  if (extraChars <= 0) return 0;
  const atFloor = (extraChars / minCharsPerSec) * 1000;
  return Math.min(windowMs, Math.max(1, atFloor));
}

/**
 * Reveal `target` from the already-shown prefix over `progress` 0..1.
 * Snaps when the target is not a prefix of `from`.
 */
export function pacedPrefix(
  from: string,
  target: string,
  progress: number,
): string {
  if (from === target) return target;
  if (!target.startsWith(from)) return target;
  const extra = target.length - from.length;
  const clamped = Math.min(1, Math.max(0, progress));
  const take = Math.max(1, Math.ceil(extra * clamped));
  return target.slice(0, from.length + take);
}

function lastTextPartIndex(parts: UIMessage["parts"]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.type === "text") return index;
  }
  return -1;
}

function textAt(message: UIMessage | undefined, partIndex: number): string {
  const part = message?.parts[partIndex];
  return part?.type === "text" ? part.text : "";
}

function withPacedLastText(
  messages: UIMessage[],
  pacedText: string,
): UIMessage[] {
  if (messages.length === 0) return messages;
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  if (!last || last.role !== "assistant") return messages;
  const partIndex = lastTextPartIndex(last.parts);
  if (partIndex < 0) return messages;
  const part = last.parts[partIndex];
  if (part?.type !== "text" || part.text === pacedText) return messages;

  const nextParts = last.parts.slice();
  nextParts[partIndex] = { ...part, text: pacedText };
  const nextMessages = messages.slice();
  nextMessages[lastIndex] = { ...last, parts: nextParts };
  return nextMessages;
}

/**
 * Reveal the latest assistant text over the flush window so a 1000ms Flue
 * dump is not committed to the DOM all at once.
 */
export function usePacedUiMessages(
  messages: UIMessage[],
  streaming: boolean,
  flushWindowMs = FLUE_CANONICAL_FLUSH_MS,
): UIMessage[] {
  const [paced, setPaced] = useState(messages);
  const shownTextRef = useRef("");

  useEffect(() => {
    const last = messages.at(-1);
    const partIndex = last ? lastTextPartIndex(last.parts) : -1;
    const target = last?.role === "assistant" ? textAt(last, partIndex) : "";

    if (!streaming || last?.role !== "assistant" || partIndex < 0) {
      shownTextRef.current = target;
      setPaced(messages);
      return;
    }

    if (!target.startsWith(shownTextRef.current)) {
      shownTextRef.current = target;
      setPaced(messages);
      return;
    }

    if (shownTextRef.current === target) {
      setPaced(messages);
      return;
    }

    const from = shownTextRef.current;
    const durationMs = revealDurationMs(
      target.length - from.length,
      flushWindowMs,
    );
    const started = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const next = pacedPrefix(from, target, (now - started) / durationMs);
      shownTextRef.current = next;
      setPaced(withPacedLastText(messages, next));
      if (next !== target) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [flushWindowMs, messages, streaming]);

  return paced;
}
