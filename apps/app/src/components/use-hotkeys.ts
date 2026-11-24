import { useEffect, useRef } from "react";

export type HotkeyMap = Readonly<
  Record<string, ((event: KeyboardEvent) => void) | undefined>
>;

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable=''], [contenteditable='true']",
    ),
  );
}

/** A menu, dialog, or listbox has the keyboard while it is open. */
function popupOpen() {
  return Boolean(
    document.querySelector(
      "[role='menu'], [role='dialog'], [role='alertdialog'], [role='listbox']",
    ),
  );
}

/**
 * Single-key page shortcuts (Linear's j/k, Enter, Escape). Keys are matched
 * on `event.key`. They stand down while the user types in a field, holds a
 * modifier, or has a popup open, so they never steal from those.
 */
export function useHotkeys(keys: HotkeyMap, enabled = true) {
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.repeat && event.key === "Enter")) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || popupOpen()) return;
      const handler = keysRef.current[event.key];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
