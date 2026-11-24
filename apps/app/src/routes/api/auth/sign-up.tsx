import { createFileRoute } from "@tanstack/react-router";
import { getSignUpUrl } from "@workos/authkit-tanstack-react-start";

// Sends a visitor to AuthKit's hosted sign-up screen. The marketing site's
// Get Started buttons link here. When sign-ups are restricted to a waitlist
// in the WorkOS dashboard, AuthKit shows its waitlist on this same screen.
export const Route = createFileRoute("/api/auth/sign-up")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const returnPathname = new URL(request.url).searchParams.get(
          "returnPathname",
        );
        const url = await getSignUpUrl(
          returnPathname ? { data: { returnPathname } } : undefined,
        );
        return new Response(null, {
          status: 307,
          headers: { Location: url },
        });
      },
    },
  },
});
