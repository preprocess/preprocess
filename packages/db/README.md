# @preprocess/db

The Postgres schema, its migrations, the tenant data layer and the audit chain
(design docs [01](../../docs/design/01-postgres-schema.md) and
[02](../../docs/design/02-audit-chain.md)).

| Export                    | What it is                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `@preprocess/db/client`   | `withOrg(env, org, fn)` and `withoutOrg(env, reason, fn)`: the only way to reach Postgres |
| `@preprocess/db/audit`    | `audit(tx, event)`, the only writer of audit events, and `verifyAuditChain`               |
| `@preprocess/db/schema/*` | Drizzle tables: `auth` (Better Auth's), `access`, `secrets`, `cases`, `audit`             |
| `@preprocess/db/ids`      | `newId(kind)`: prefixed, time-ordered text ids                                            |

## Roles

| Role                     | Binding     | RLS      | Used for                                                |
| ------------------------ | ----------- | -------- | ------------------------------------------------------- |
| `preprocess_app`         | `DB`        | enforced | everything tenant-scoped, through `withOrg`             |
| `preprocess_system`      | `DB_SYSTEM` | bypassed | Better Auth's adapter and `withoutOrg`                  |
| `preprocess_audit_purge` | none yet    | enforced | deleting a deleted organization's year-old audit events |
| `preprocess_migrator`    | none        | owner    | applying migrations                                     |

A hosted server gets these from [`bootstrap.sql`](bootstrap.sql), run once by an
administrator; self-hosters do the same. Locally, `pnpm db:migrate` creates them
with local-only passwords (the role name).

## Adding a table

- A tenant table carries `organization_id` and, in the same migration, gets
  `ENABLE` and `FORCE ROW LEVEL SECURITY`, the `tenant` policy and explicit
  grants to `preprocess_app` and `preprocess_system` (see
  `migrations/0001_security.sql`). `test/tenant-isolation.test.ts` fails for any
  table with `organization_id` that lacks RLS or is missing from its list.
- Point foreign keys between tenant tables at `(organization_id, id)`, so a row
  can never reference another organization's row.
- Run `pnpm --filter @preprocess/db generate` for schema changes, and
  `pnpm --filter @preprocess/db exec drizzle-kit generate --custom` for SQL
  drizzle-kit does not write (policies, grants, triggers).

## Tests

`pnpm --filter @preprocess/db test` runs in the Workers runtime against a fresh
`preprocess_test_db` on local Postgres (`TEST_DATABASE_URL` overrides it).
