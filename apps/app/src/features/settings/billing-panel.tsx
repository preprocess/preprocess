import { SettingsRow, SettingsRows } from "./kit";

export function BillingPanel() {
  return (
    <SettingsRows>
      <SettingsRow label="Plan" value="Not set up yet." />
      <SettingsRow label="Payment method" value="Not set up yet." />
      <SettingsRow label="Invoices" value="Not set up yet." />
    </SettingsRows>
  );
}
