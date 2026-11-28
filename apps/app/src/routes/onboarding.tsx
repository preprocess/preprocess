import { createFileRoute } from "@tanstack/react-router";

import { OnboardingCreateOrg } from "../components/onboarding-create-org";
import { useAuth } from "../features/auth/auth-context";
import { safeRedirect } from "../features/auth/safe-redirect";

// The root loader sends people here only while they have no organization,
// with the page they were going to as `redirect`.
export const Route = createFileRoute("/onboarding")({
  validateSearch: (search): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  component: OnboardingPage,
});

function OnboardingPage() {
  const { user } = useAuth();
  const { redirect } = Route.useSearch();
  return (
    <OnboardingCreateOrg
      email={user?.email ?? ""}
      next={safeRedirect(redirect)}
    />
  );
}
