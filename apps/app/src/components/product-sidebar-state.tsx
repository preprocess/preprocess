import { createContext, type ReactNode } from "react";

export const ProductSidebarOpenContext = createContext(true);

export function ProductSidebarOpenProvider({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  return (
    <ProductSidebarOpenContext.Provider value={open}>
      {children}
    </ProductSidebarOpenContext.Provider>
  );
}
