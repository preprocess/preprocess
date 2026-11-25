import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@preprocess/ui/components/field";
import { Input, type InputProps } from "@preprocess/ui/components/input";
import { PasswordInput } from "@preprocess/ui/components/password-input";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import type { ChangeEvent, ReactNode } from "react";

import { AuthPanel } from "./auth-panel";
import { PreprocessMark } from "./preprocess-mark";

/**
 * The split page sign-in, sign-up and invitations share: the form on the
 * page's own surface, and the branded art on the right. The art drops on
 * narrow screens.
 */
export function AuthLayout({
  title,
  subtitle,
  description,
  children,
  footer,
}: {
  /** The headline's first line. */
  title: string;
  /** The headline's second line. */
  subtitle?: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid h-svh bg-background lg:grid-cols-2">
      <ScrollArea className="h-svh" viewportClassName="scroll-fade h-full">
        <main className="flex min-h-svh items-center justify-center py-12">
          <div className="w-[min(calc(100%-48px),400px)]">
            <header className="mb-8 flex flex-col items-start">
              <PreprocessMark className="mb-6 size-7" title="Preprocess" />
              <h1
                className="text-display tracking-[-0.03em] text-foreground"
                style={{ fontVariationSettings: fontWeights.semibold }}
              >
                <span className="block">{title}</span>
                {subtitle ? <span className="block">{subtitle}</span> : null}
              </h1>
              {description ? (
                <p className="mt-3 text-subtitle text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </header>
            {children}
            {footer ? (
              <p className="mt-6 text-center text-subtitle text-muted-foreground">
                {footer}
              </p>
            ) : null}
          </div>
        </main>
      </ScrollArea>
      <div className="relative hidden lg:block">
        <AuthPanel />
      </div>
    </div>
  );
}

/** A labelled input for these forms: Fluid's Field and Input, with the error replacing the hint. */
export function AuthField({
  id,
  label,
  hint,
  error,
  onChange,
  type,
  ...input
}: Omit<InputProps, "id" | "onChange"> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const control = {
    "aria-invalid": error ? true : undefined,
    id,
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      onChange(event.target.value),
    ...input,
  };
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {type === "password" ? (
        <PasswordInput {...control} />
      ) : (
        <Input type={type} {...control} />
      )}
      {error ? (
        <FieldError>{error}</FieldError>
      ) : hint ? (
        <FieldDescription>{hint}</FieldDescription>
      ) : null}
    </Field>
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
