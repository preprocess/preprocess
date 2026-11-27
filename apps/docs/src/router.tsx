import { createRouter } from "@tanstack/react-router";

import { NotFound } from "@/components/not-found";

import { routeTree } from "./routeTree.gen";

export const getRouter = () =>
  createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    scrollToTopSelectors: ['[data-scroll-restoration-id="docs-content"]'],
    defaultNotFoundComponent: NotFound,
  });
