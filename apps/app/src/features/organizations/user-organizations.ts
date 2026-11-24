import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";

import { PREVIEW_BUILD, PREVIEW_ORGANIZATION } from "../../preview/mode";
import { validateOrganizationName } from "../../server/organization-name";
import type { UserOrganization } from "./user-organization";

export type { UserOrganization };

export async function listWorkOsOrganizations(
  userId: string,
): Promise<UserOrganization[]> {
  const { getWorkOS } = await import("../../server/workos.server");
  const memberships =
    await getWorkOS().userManagement.listOrganizationMemberships({
      userId,
      statuses: ["active"],
      limit: 100,
    });

  return memberships.data
    .map((membership) => ({
      id: membership.organizationId,
      name: membership.organizationName,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export const loadUserOrganizations = createServerFn({ method: "GET" }).handler(
  async (): Promise<UserOrganization[]> => {
    const auth = await getAuth();
    if (!auth.user) {
      return [];
    }
    if (PREVIEW_BUILD) return [PREVIEW_ORGANIZATION];

    return listWorkOsOrganizations(auth.user.id);
  },
);

export async function createWorkOsOrganization(
  userId: string,
  name: string,
): Promise<{ organizationId: string }> {
  const { getWorkOS } = await import("../../server/workos.server");
  const workos = getWorkOS();
  const organization = await workos.organizations.createOrganization({ name });
  await workos.userManagement.createOrganizationMembership({
    organizationId: organization.id,
    userId,
    roleSlug: "admin",
  });
  return { organizationId: organization.id };
}

type OrganizationMembershipRoles = {
  role?: { slug?: string } | null;
  roleSlug?: string;
  roles?: Array<{ slug?: string } | string>;
};

function membershipRoleSlugs(membership: OrganizationMembershipRoles) {
  const slugs: string[] = [];
  if (membership.role?.slug) slugs.push(membership.role.slug);
  if (membership.roleSlug) slugs.push(membership.roleSlug);
  for (const role of membership.roles ?? []) {
    const slug = typeof role === "string" ? role : role.slug;
    if (slug) slugs.push(slug);
  }
  return slugs.map((slug) => slug.trim().toLowerCase());
}

export function membershipIsOwner(membership: OrganizationMembershipRoles) {
  return membershipRoleSlugs(membership).includes("owner");
}

export async function updateWorkOsOrganizationName(
  userId: string,
  organizationId: string,
  name: string,
): Promise<{ organizationId: string; name: string }> {
  const { getWorkOS } = await import("../../server/workos.server");
  const workos = getWorkOS();
  const memberships = await workos.userManagement.listOrganizationMemberships({
    userId,
    organizationId,
    statuses: ["active"],
    limit: 1,
  });
  const membership = memberships.data[0] as
    OrganizationMembershipRoles | undefined;
  if (!membership) {
    throw new Error("You do not have access to this organization.");
  }
  if (!membershipIsOwner(membership)) {
    throw new Error("Only the owner can change the organization name.");
  }

  const organization = await workos.organizations.updateOrganization({
    organization: organizationId,
    name,
  });
  return { organizationId: organization.id, name: organization.name };
}

export async function deleteWorkOsOrganization(
  userId: string,
  organizationId: string,
): Promise<{ organizationId: string }> {
  const { getWorkOS } = await import("../../server/workos.server");
  const workos = getWorkOS();
  const memberships = await workos.userManagement.listOrganizationMemberships({
    userId,
    organizationId,
    statuses: ["active"],
    limit: 1,
  });
  const membership = memberships.data[0] as
    OrganizationMembershipRoles | undefined;
  if (!membership) {
    throw new Error("You do not have access to this organization.");
  }
  if (!membershipIsOwner(membership)) {
    throw new Error("Only the owner can delete this organization.");
  }

  await workos.organizations.deleteOrganization(organizationId);
  return { organizationId };
}

export const deleteUserOrganization = createServerFn({
  method: "POST",
}).handler(async () => {
  const auth = await getAuth();
  if (!auth.user || !auth.organizationId) {
    throw new Error("Sign in to an organization to continue.");
  }

  return deleteWorkOsOrganization(auth.user.id, auth.organizationId);
});

export const updateUserOrganization = createServerFn({ method: "POST" })
  .validator((input: { name: string }) => {
    const result = validateOrganizationName(input.name);
    if (!result.ok) {
      throw new Error(result.error);
    }
    return { name: result.name };
  })
  .handler(async ({ data }) => {
    const auth = await getAuth();
    if (!auth.user || !auth.organizationId) {
      throw new Error("Sign in to an organization to continue.");
    }

    return updateWorkOsOrganizationName(
      auth.user.id,
      auth.organizationId,
      data.name,
    );
  });

export const createUserOrganization = createServerFn({ method: "POST" })
  .validator((input: { name: string }) => {
    const result = validateOrganizationName(input.name);
    if (!result.ok) {
      throw new Error(result.error);
    }
    return { name: result.name };
  })
  .handler(async ({ data }) => {
    const auth = await getAuth();
    if (!auth.user) {
      throw new Error("Sign in to create an organization.");
    }

    return createWorkOsOrganization(auth.user.id, data.name);
  });
