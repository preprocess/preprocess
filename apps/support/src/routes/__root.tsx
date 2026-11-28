import { FluidProvider } from "@preprocess/ui/lib/fluid-provider";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import { loadHelpCenter } from "@/lib/help";
import appCss from "@/styles/app.css?url";

export const Route = createRootRoute({
  // The categories and links every page's shell draws from.
  loader: () => loadHelpCenter(),
  staleTime: Infinity,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Preprocess Support" },
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
        <RootProvider search={{ enabled: false }}>
          <FluidProvider shape="pill">
            <Outlet />
          </FluidProvider>
        </RootProvider>
        <Scripts />
      </body>
    </html>
  ),
});
