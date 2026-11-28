import { createFileRoute } from "@tanstack/react-router";

import { SupportArticle } from "@/components/support-article";
import { SupportShell } from "@/components/support-shell";
import { useHelp } from "@/lib/use-help";

export const Route = createFileRoute("/contact")({
  head: () => ({ meta: [{ title: "Contact support · Preprocess Support" }] }),
  component: Contact,
});

// Until the requests API exists, contact is by email.
function Contact() {
  const help = useHelp();
  return (
    <SupportShell help={help} title="Contact support">
      <SupportArticle
        description="Support requests open here soon."
        help={help}
        title="Contact support"
        url="/contact"
      >
        <p>
          Until then, email us at{" "}
          <a href="mailto:support@preprocess.com">support@preprocess.com</a>.
        </p>
      </SupportArticle>
    </SupportShell>
  );
}
