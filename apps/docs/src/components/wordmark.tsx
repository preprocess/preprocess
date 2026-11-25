import { cn } from "@preprocess/ui/lib/utils";

// The Preprocess lockup: the mark drawn in currentColor, then the name set
// as www.preprocess.com sets it. The mark alone stands in where the name
// would repeat (the home hero, the folded mobile header).
export function Wordmark({
  compact = false,
  markOnly = false,
  className,
}: {
  compact?: boolean;
  markOnly?: boolean;
  className?: string;
}) {
  const mark = (
    <svg
      aria-hidden
      className={cn(
        "shrink-0 text-foreground",
        markOnly ? className : compact ? "size-4.5" : "size-5",
      )}
      fill="none"
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M35.55,42.67H7.12C3.19,42.67,0,45.85,0,49.79v156.43C0,210.15,3.19,213.33,7.12,213.33h28.43c3.93,0,7.12,3.19,7.12,7.12v28.43c0,3.93,3.19,7.12,7.12,7.12h42.65c3.93,0,7.12-3.19,7.12-7.12v-42.65c0-3.93-3.19-7.12-7.12-7.12h-28.43c-3.93,0-7.12-3.19-7.12-7.12v-127.98c0-3.93,3.19-7.12,7.12-7.12h28.43c3.93,0,7.12-3.19,7.12-7.12V7.12C99.56,3.19,96.37,0,92.44,0h-42.65C45.85,0,42.67,3.19,42.67,7.12v28.43c0,3.93-3.19,7.12-7.12,7.12Z"
        fill="currentColor"
      />
      <path
        d="M156.44,7.11v42.67c0,3.93,3.18,7.11,7.11,7.11h28.44c3.93,0,7.11,3.18,7.11,7.11v128c0,3.93-3.18,7.11-7.11,7.11h-28.44c-3.93,0-7.11,3.18-7.11,7.11v42.67c0,3.93,3.18,7.11,7.11,7.11h42.67c3.93,0,7.11-3.18,7.11-7.11v-28.44c0-3.93,3.18-7.11,7.11-7.11h28.44c3.93,0,7.11-3.18,7.11-7.11V49.78c0-3.93-3.18-7.11-7.11-7.11h-28.44c-3.93,0-7.11-3.18-7.11-7.11V7.11C213.33,3.18,210.15,0,206.22,0h-42.67C159.63,0,156.44,3.18,156.44,7.11Z"
        fill="currentColor"
      />
    </svg>
  );
  if (markOnly) return mark;
  return (
    <span
      className={cn(
        "flex min-w-0 items-center text-foreground",
        compact ? "gap-2" : "gap-2.5",
        className,
      )}
    >
      {mark}
      <span className={cn("truncate", compact ? "lockup-compact" : "lockup")}>
        Preprocess
      </span>
    </span>
  );
}
