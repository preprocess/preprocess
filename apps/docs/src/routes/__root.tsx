import { FluidProvider } from "@preprocess/ui/lib/fluid-provider";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import appCss from "@/styles/app.css?url";

const translations = {
  "Path Parameters(operation page)": "Path parameters",
  "Query Parameters(operation page)": "Query parameters",
  "Header Parameters(operation page)": "Header parameters",
  "Cookie Parameters(operation page)": "Cookie parameters",
  "Request Body(operation page)": "Request body",
  "Response Body(operation page)": "Response body",
};

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Preprocess docs" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "icon",
        href: "/brand/favicon-light.svg",
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "icon",
        href: "/brand/favicon-dark.svg",
        media: "(prefers-color-scheme: dark)",
      },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="fixed inset-0 h-svh overflow-hidden overscroll-none">
        <RootProvider i18n={{ translations }} search={{ enabled: false }}>
          <FluidProvider shape="pill">
            <Outlet />
          </FluidProvider>
        </RootProvider>
        <Scripts />
      </body>
    </html>
  ),
});
