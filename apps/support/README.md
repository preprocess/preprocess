# Help center

The help center at support.preprocess.com (PRE-155, support-center spec): help
articles and the docs' search for signed-out visitors, and the way to contact
support.

## Why its own Worker

It is a Worker of its own (TanStack Start with Fumadocs, like `apps/docs`), not
a route on the app:

- It serves signed-out visitors publicly and caches like the docs.
- It deploys and rolls back on its own, apart from the app.
- It is hosted-only. Selfhost stages don't deploy it, so a self-hosted install
  has no support intake and keeps its data local; the app's Help menu points a
  self-hosted install at our center for license holders or at a URL the customer
  sets.
- It reuses the docs' Markdown pipeline and search (`@preprocess/search`)
  instead of putting public content inside the authenticated app's bundle.

## Articles

Articles are plain Markdown (`.md`, GitHub Flavored Markdown, no MDX components)
in `content/articles/<category>/<slug>.md`, built into the bundle and published
on deploy. Each has frontmatter:

```md
---
title: Connect GitHub
description: One sentence that says what the article covers.
updated: 2026-11-28
---
```

The folder is the category, one of the six in `src/lib/categories.ts`, in this
order: `getting-started`, `agents`, `billing-and-credits`, `integrations`,
`security-and-sso` and `self-hosting`. Each folder's `meta.json` holds the
category's title and its articles in order:

```json
{ "title": "Integrations (GitHub, MCP)", "pages": ["connect-github"] }
```

`scripts/check-articles.ts` runs in `pnpm lint` and `pnpm build` and fails on an
unknown category folder, missing frontmatter, or an article that `meta.json`
doesn't list.

## Pages

- `/`: the search box, the categories with their articles, and Contact support.
- `/<category>`: a category's articles.
- `/<category>/<slug>`: an article, with breadcrumbs.
- `/contact`: contact by email until the request form lands.
- `/api/search`: the search index, `{ articles, docs }`. The articles are this
  site's own; the docs pages come from the docs Worker's `/api/search` at
  `DOCS_URL`, cached for five minutes, with absolute URLs. Search shows help
  articles before docs.

The shell and article are the docs site's (`apps/docs/src/components/`). The
home and category pages are skeletons until Design's layouts land (PLAT-143).

## Configuration

`APP_URL`, `DOCS_URL` and `STATUS_URL` are vars, declared in
`infra/alchemy.run.ts` (`wrangler.jsonc` is generated for local development by
`infra/scripts/wrangler-config.ts`). Production serves the site on
`SUPPORT_DOMAIN`; other stages use workers.dev.

`pnpm dev` serves it at https://support.preprocess.localhost.
