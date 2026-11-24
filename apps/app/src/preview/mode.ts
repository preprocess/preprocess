declare const __PREPROCESS_PREVIEW__: boolean;

/**
 * Preview mode (`pnpm dev:preview`): the dev server signs in without WorkOS.
 * vite.config.ts refuses it for any build, so deployable bundles compile this
 * to `false` and drop every branch behind it.
 */
export const PREVIEW_BUILD: boolean = __PREPROCESS_PREVIEW__;

/** The one organization a preview session belongs to. */
export const PREVIEW_ORGANIZATION = {
  id: "org_preview",
  name: "Preview Org",
} as const;
