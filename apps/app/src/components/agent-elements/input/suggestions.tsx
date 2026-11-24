"use client";

import { Button } from "@preprocess/ui/components/button";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export type SuggestionItem = {
  id: string;
  label: string;
  value?: string;
  icon?: ReactNode;
  className?: string;
};

export type SuggestionsProps = {
  items: SuggestionItem[];
  onSelect: (item: SuggestionItem) => void;
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
};

export function Suggestions({
  items,
  onSelect,
  disabled,
  className,
  itemClassName,
}: SuggestionsProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {items.map((item) => (
        <Button
          key={item.id}
          type="button"
          variant="secondary"
          size="compact"
          disabled={disabled}
          onClick={() => onSelect(item)}
          className={cn(
            "px-2 text-body text-an-foreground-muted hover:text-an-foreground",
            itemClassName,
            item.className,
          )}
        >
          {item.icon && (
            <span className="mr-1 inline-flex shrink-0 align-middle">
              {item.icon}
            </span>
          )}
          {item.label}
        </Button>
      ))}
    </div>
  );
}
