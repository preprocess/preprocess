import { createFileRoute, redirect } from "@tanstack/react-router";

import { OnboardingCreateOrg } from "../components/onboarding-create-org";
import { prepareOnboarding } from "../features/onboarding/prepare-onboarding";

export const Route = createFileRoute("/onboarding")({
  loader: async () => {
    const result = await prepareOnboarding();

    switch (result.status) {
      case "unauthenticated":
        throw redirect({ href: "/api/auth/sign-in" });
      case "ready":
        throw redirect({ to: "/" });
      case "needs_org":
        return { email: result.email };
      default: {
        const _exhaustive: never = result;
        throw new Error(`Unhandled onboarding status: ${String(_exhaustive)}`);
      }
    }
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const { email } = Route.useLoaderData();
  return <OnboardingCreateOrg email={email} />;
}
