import { Button } from "@preprocess/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@preprocess/ui/components/empty";

import { useHelp } from "@/lib/use-help";

import { HelpLink } from "./help-link";
import { SupportShell } from "./support-shell";

function Missing() {
  return (
    <Empty className="min-h-[60svh]">
      <EmptyHeader>
        <EmptyTitle>Page not found</EmptyTitle>
        <EmptyDescription>
          There is no help page at this address.
        </EmptyDescription>
      </EmptyHeader>
      <Button render={<HelpLink url="/" />} variant="secondary">
        Back to the help center
      </Button>
    </Empty>
  );
}

// A missing page inside the help center's shell, so the sidebar and search
// still lead somewhere.
export function NotFound() {
  return (
    <SupportShell help={useHelp()}>
      <Missing />
    </SupportShell>
  );
}
