import { createFileRoute } from "@tanstack/react-router";

import { OnboardingCreateOrg } from "../components/onboarding-create-org";
import { useAuth } from "../features/auth/auth-context";

// The root loader sends people here only while they have no organization.
export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});

function OnboardingPage() {
  const { user } = useAuth();
  return <OnboardingCreateOrg email={user?.email ?? ""} />;
}
