// Turnstile's siteverify, as the API Worker sees it in tests: the token
// "pass" passes with the test secret, and every other token fails.

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export const fakeTurnstile = async (request: Request) => {
  const form = await request.formData();
  const success =
    form.get("secret") === "test-turnstile-secret" &&
    form.get("response") === "pass";
  return Response.json({
    success,
    "error-codes": success ? [] : ["invalid-input-response"],
  });
};
