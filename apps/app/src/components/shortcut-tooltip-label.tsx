/**
 * A tooltip label with its keyboard shortcut as key chips, matching the
 * sidebar trigger's tooltip (Fluid's ShortcutKbd). Any tooltip that names a
 * shortcut uses this instead of writing the key into the text.
 */
export function ShortcutTooltipLabel({
  label,
  keys,
}: Readonly<{ label: string; keys: readonly string[] }>) {
  return (
    <span className="flex items-center gap-1.5">
      {/* A flex row escapes the surface's text-box trim, so the label
          re-applies it, as the sidebar trigger's tooltip does. */}
      <span className="[text-box:trim-both_cap_alphabetic]">{label}</span>
      <span className="flex items-center gap-0.5">
        {keys.map((key) => (
          <kbd
            className="-my-1 flex h-4 min-w-4 items-center justify-center rounded border border-background/30 px-1 font-sans text-[length:var(--fs-micro-compact,10px)] leading-[var(--lh-micro-compact,12px)] text-background"
            key={key}
          >
            {key}
          </kbd>
        ))}
      </span>
    </span>
  );
}
