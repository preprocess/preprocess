import { authPost } from "../auth/client";

export type { UserOrganization } from "./user-organization";

function slugFor(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = crypto.randomUUID().slice(0, 6);
  return base ? `${base}-${suffix}` : suffix;
}

/** Creates an organization owned by the caller and makes it active. */
export async function createOrganization(name: string) {
  const organization = await authPost<{ id: string }>("/organization/create", {
    name,
    slug: slugFor(name),
  });
  await authPost("/organization/set-active", {
    organizationId: organization.id,
  });
  return { organizationId: organization.id };
}

export const updateOrganization = (organizationId: string, name: string) =>
  authPost<{ id: string; name: string }>("/organization/update", {
    organizationId,
    data: { name },
  });

export const deleteOrganization = (organizationId: string) =>
  authPost("/organization/delete", { organizationId });
