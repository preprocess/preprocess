import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@preprocess/ui/components/field";
import { Input } from "@preprocess/ui/components/input";
import { PasswordInput } from "@preprocess/ui/components/password-input";
import {
  useInlineValidation,
  type Validator,
} from "@preprocess/ui/hooks/use-inline-validation";
import {
  forwardRef,
  useId,
  useImperativeHandle,
  type ComponentProps,
} from "react";

export type ValidatedFieldHandle = {
  /** Shows the field's error, if any, and returns true when it is valid. */
  commit: () => boolean;
  reset: () => void;
};

/**
 * A labeled Fluid Input that validates on submit: the form calls
 * `commit()`, and from then on the error follows the value as it is fixed.
 */
export const ValidatedField = forwardRef<
  ValidatedFieldHandle,
  {
    label: string;
    value: string;
    onChange: (value: string) => void;
    validate: Validator;
    hint?: string;
    id?: string;
    className?: string;
  } & Pick<
    ComponentProps<"input">,
    | "autoComplete"
    | "autoFocus"
    | "disabled"
    | "inputMode"
    | "name"
    | "placeholder"
    | "required"
    | "type"
  >
>(function ValidatedField(
  { label, value, onChange, validate, hint, id, className, type, ...input },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  const { error, commit, reset } = useInlineValidation({ value, validate });

  useImperativeHandle(
    ref,
    () => ({
      commit: () => {
        commit();
        return validate(value) === null;
      },
      reset,
    }),
    [commit, reset, validate, value],
  );

  const control = {
    "aria-invalid": error ? true : undefined,
    id: fieldId,
    value,
    onChange: (event: { target: { value: string } }) =>
      onChange(event.target.value),
    ...input,
  };

  return (
    <Field className={className} data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
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
});
