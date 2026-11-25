import { AuthField } from "./auth-layout";

export type PersonName = { firstName: string; lastName: string };
export type NameErrors = { firstName?: string; lastName?: string };

export const nameErrors = ({
  firstName,
  lastName,
}: PersonName): NameErrors => ({
  ...(firstName.trim() ? {} : { firstName: "Enter your first name." }),
  ...(lastName.trim() ? {} : { lastName: "Enter your last name." }),
});

/** First and last name side by side, as the person wants to be shown. */
export function NameFields({
  value,
  errors,
  disabled,
  onChange,
}: Readonly<{
  value: PersonName;
  errors: NameErrors;
  disabled?: boolean;
  onChange: (value: PersonName, field: keyof PersonName) => void;
}>) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <AuthField
        autoComplete="given-name"
        autoFocus
        disabled={disabled}
        error={errors.firstName}
        id="first-name"
        label="First name"
        onChange={(firstName) => onChange({ ...value, firstName }, "firstName")}
        value={value.firstName}
      />
      <AuthField
        autoComplete="family-name"
        disabled={disabled}
        error={errors.lastName}
        id="last-name"
        label="Last name"
        onChange={(lastName) => onChange({ ...value, lastName }, "lastName")}
        value={value.lastName}
      />
    </div>
  );
}
