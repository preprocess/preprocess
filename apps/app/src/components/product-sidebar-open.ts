import { SIDEBAR_COOKIE_NAME } from "@preprocess/ui/components/sidebar";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

// The Fluid sidebar writes "true"/"false" to this cookie; open by default.
export const loadProductSidebarOpen = createServerFn({ method: "GET" }).handler(
  (): boolean => getCookie(SIDEBAR_COOKIE_NAME) !== "false",
);
