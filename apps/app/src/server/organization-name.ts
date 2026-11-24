const MAX_ORG_NAME_LENGTH = 80;

export function normalizeOrganizationName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

export function validateOrganizationName(name: string) {
  const normalized = normalizeOrganizationName(name);
  if (!normalized) {
    return { ok: false as const, error: "Enter an organization name." };
  }
  if (normalized.length > MAX_ORG_NAME_LENGTH) {
    return {
      ok: false as const,
      error: `Keep the name under ${MAX_ORG_NAME_LENGTH} characters.`,
    };
  }
  return { ok: true as const, name: normalized };
}
