# Contributing

Thank you for your interest. We are not accepting outside contributions yet: a
workflow closes pull requests from people outside the Preprocess organization,
with a note pointing here. We will say so in this file when that changes, and
there is no contributor agreement to sign until then.

Issues are open. Bug reports are welcome, ideally with steps to reproduce and
the versions you used.

## Versioning

- **SDK and CLI.** `packages/sdk` and `packages/cli` follow
  [semantic versioning](https://semver.org): a breaking change needs a new major
  version. Every deployment records the SDK version it was built with, and the
  runtime supports every SDK version within a major version.
- **API.** The HTTP API is versioned in its path (`/v1`). Changes within a
  version are additive; removing or changing behavior follows the deprecation
  policy in the API reference (`apps/docs/content/docs/api/index.mdx`): mark it
  deprecated in the OpenAPI schema, announce it in the upgrade notes, and keep
  it working for at least 12 months.
- **Shared libraries.** UI, auth and the other shared packages live in
  [preprocess/kit](https://github.com/preprocess/kit), which versions them with
  changesets.

## Tests

Tests use Vitest inside the Workers runtime (`@cloudflare/vitest-plugin`), so
they run against real Durable Objects, R2 and queues:

```sh
pnpm test
```

Tests are required for tenant isolation, auth, billing, license and
entitlements, and optional elsewhere.
