export async function mintWidgetsApiToken(
  userId: string,
  organizationId: string,
): Promise<string> {
  if (!organizationId) {
    throw new Error(
      "Select an organization before issuing a Widgets API token.",
    );
  }
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) throw new Error("WORKOS_API_KEY is not configured.");

  const response = await fetch("https://api.workos.com/client/token", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      organization_id: organizationId,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Could not issue a Widgets API token (${response.status}).`,
    );
  }
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    !("token" in body) ||
    typeof body.token !== "string"
  ) {
    throw new Error("Widgets API token response was empty.");
  }
  return body.token;
}
