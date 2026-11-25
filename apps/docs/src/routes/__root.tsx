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
  "Filter Properties(schema UI)": "Filter properties",
  "Response Body(operation page)": "Responses",
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
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Outside head().meta, which keeps one meta per name. */}
        <meta
          name="theme-color"
          content="#fbf7f0"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#15120f"
          media="(prefers-color-scheme: dark)"
        />
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
