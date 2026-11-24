"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import type { UserOrganization } from "./user-organization";

type OrganizationsContextValue = {
  organizations: UserOrganization[];
  renameOrganization: (id: string, name: string) => void;
};

const OrganizationsContext = createContext<
  OrganizationsContextValue | undefined
>(undefined);

export function OrganizationsProvider({
  organizations,
  children,
}: {
  organizations: UserOrganization[];
  children: ReactNode;
}) {
  const [items, setItems] = useState(organizations);
  const renameOrganization = useCallback((id: string, name: string) => {
    setItems((current) =>
      current.map((organization) =>
        organization.id === id ? { ...organization, name } : organization,
      ),
    );
  }, []);

  return (
    <OrganizationsContext.Provider
      value={{ organizations: items, renameOrganization }}
    >
      {children}
    </OrganizationsContext.Provider>
  );
}

export function useOrganizations(): UserOrganization[] {
  return useContext(OrganizationsContext)?.organizations ?? [];
}

export function useRenameOrganization() {
  return (
    useContext(OrganizationsContext)?.renameOrganization ??
    ((_id: string, _name: string) => {})
  );
}
