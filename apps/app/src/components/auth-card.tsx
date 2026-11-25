import { fontWeights } from "@preprocess/ui/lib/font-weight";
import type { ReactNode } from "react";

import { PreprocessMark } from "./preprocess-mark";

/** The centered card sign-in, sign-up and invitations share. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-svh items-center justify-center overflow-hidden bg-background">
      <div className="w-[min(calc(100%-48px),360px)] bg-surface-3 p-8 shadow-surface-3">
        <header className="mb-7 flex flex-col items-start gap-2">
          <PreprocessMark className="mb-3 size-7" title="Preprocess" />
          <h1
            className="w-full text-left text-display leading-normal tracking-[-0.03em] text-foreground"
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            {title}
          </h1>
          {description ? (
            <p className="w-full text-left text-subtitle leading-normal text-muted-foreground">
              {description}
            </p>
          ) : null}
        </header>
        {children}
        {footer ? (
          <p className="mt-6 text-center text-body text-muted-foreground">
            {footer}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export const authLinkClass =
  "text-foreground underline-offset-4 hover:underline";

/** A same-origin path to return to after signing in, or "/". */
export function safeRedirect(value: unknown) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
    ? value
    : "/";
}
