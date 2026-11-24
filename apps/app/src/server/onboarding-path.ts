/** Post-auth organization setup routes (authenticated, org not required). */
export function isOnboardingPath(pathname: string) {
  return pathname === "/onboarding" || pathname.startsWith("/onboarding/");
}
