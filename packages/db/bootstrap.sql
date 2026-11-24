-- One-time setup of the Postgres login roles, run by an administrator before
-- the first migration (design doc 01). Self-hosters run it too:
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
--     -v migrator_password=... -v app_password=... \
--     -v system_password=... -v purge_password=... \
--     -f packages/db/bootstrap.sql
--
-- preprocess_migrator owns the tables and applies migrations.
-- preprocess_app      is the DB Hyperdrive binding: RLS enforced.
-- preprocess_system   is the DB_SYSTEM binding (Better Auth, withoutOrg): RLS bypassed.
-- preprocess_audit_purge runs the deleted-organization audit purge only.
-- Rerunning it only resets passwords.

SELECT format('CREATE ROLE %I', r) FROM unnest(ARRAY[
  'preprocess_migrator', 'preprocess_app', 'preprocess_system', 'preprocess_audit_purge'
]) AS r WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r)
\gexec

ALTER ROLE preprocess_migrator LOGIN CREATEROLE PASSWORD :'migrator_password';
ALTER ROLE preprocess_app LOGIN NOBYPASSRLS PASSWORD :'app_password';
ALTER ROLE preprocess_system LOGIN BYPASSRLS PASSWORD :'system_password';
ALTER ROLE preprocess_audit_purge LOGIN NOBYPASSRLS PASSWORD :'purge_password';
GRANT CREATE, USAGE ON SCHEMA public TO preprocess_migrator;
