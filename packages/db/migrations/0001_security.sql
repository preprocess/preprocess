-- Roles, grants, row-level security and integrity triggers (design docs 01 and
-- 02). Hand-written: drizzle-kit does not generate any of this.
--
-- Login roles and their passwords come from bootstrap.sql, run once per server.
-- This migration only makes sure the roles exist, so it also applies where
-- bootstrap has not run yet (they stay NOLOGIN until it does).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preprocess_app') THEN
    CREATE ROLE preprocess_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preprocess_system') THEN
    CREATE ROLE preprocess_system NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preprocess_audit_purge') THEN
    CREATE ROLE preprocess_audit_purge NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO preprocess_app, preprocess_system, preprocess_audit_purge;
--> statement-breakpoint

-- preprocess_app: tenant-scoped product code, always through withOrg, RLS enforced.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  groups, group_members, agents, agent_grants, org_keys, secrets, cases, case_assignees
  TO preprocess_app;
GRANT SELECT ON organization, member, invitation TO preprocess_app;
GRANT SELECT (id, name, email, image, deactivated_at) ON "user" TO preprocess_app;
GRANT SELECT (id, config_id, name, start, prefix, reference_id, enabled, expires_at,
              created_at, updated_at, last_request, permissions) ON apikey TO preprocess_app;
GRANT SELECT, INSERT ON audit_events TO preprocess_app;
GRANT SELECT, UPDATE ON audit_heads TO preprocess_app;
--> statement-breakpoint

-- preprocess_system: Better Auth's adapter and withoutOrg, RLS bypassed
-- (BYPASSRLS is set by bootstrap.sql). Never updates or deletes audit events.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "user", session, account, verification, organization, member, invitation, apikey,
  groups, group_members, agents, agent_grants, org_keys, secrets, cases, case_assignees,
  audit_heads, deleted_organizations
  TO preprocess_system;
GRANT SELECT, INSERT ON audit_events TO preprocess_system;
--> statement-breakpoint

-- preprocess_audit_purge: the one role allowed to delete audit events, and only
-- a deleted organization's year-old ones (enforced by the trigger below).
GRANT SELECT, DELETE ON audit_events, audit_heads, deleted_organizations TO preprocess_audit_purge;
--> statement-breakpoint

-- Fixed organization roles (spec 2). Custom roles are paid and not in this step.
ALTER TABLE member ADD CONSTRAINT member_role_fixed CHECK (role IN ('owner', 'admin', 'member'));
ALTER TABLE invitation ADD CONSTRAINT invitation_role_fixed CHECK (role IS NULL OR role IN ('owner', 'admin', 'member'));
--> statement-breakpoint

-- Row-level security: every tenant row is visible only while the transaction's
-- app.org_id (set by withOrg) names its organization. Unset means no rows.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('organization', 'id'),
    ('member', 'organization_id'),
    ('invitation', 'organization_id'),
    ('apikey', 'reference_id'),
    ('groups', 'organization_id'),
    ('group_members', 'organization_id'),
    ('agents', 'organization_id'),
    ('agent_grants', 'organization_id'),
    ('org_keys', 'organization_id'),
    ('secrets', 'organization_id'),
    ('cases', 'organization_id'),
    ('case_assignees', 'organization_id'),
    ('audit_events', 'organization_id'),
    ('audit_heads', 'organization_id')
  ) AS v(tbl, col)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.tbl);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (%I = current_setting(''app.org_id'', true)) WITH CHECK (%I = current_setting(''app.org_id'', true))',
      t.tbl, t.col, t.col);
  END LOOP;
END
$$;
--> statement-breakpoint

-- Audit events are append-only. The only delete path is the purge role removing
-- a deleted organization's events once their one-year lock has ended (doc 02).
CREATE FUNCTION audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'preprocess_audit_purge'
     AND EXISTS (SELECT 1 FROM deleted_organizations d WHERE d.organization_id = OLD.organization_id)
     AND OLD.occurred_at < now() - interval '1 year' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only';
END
$$;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();
--> statement-breakpoint

-- A group member must be a member of the group's organization.
CREATE FUNCTION group_members_check_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM member m WHERE m.organization_id = NEW.organization_id AND m.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'user % is not a member of organization %', NEW.user_id, NEW.organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER group_members_membership BEFORE INSERT OR UPDATE ON group_members
  FOR EACH ROW EXECUTE FUNCTION group_members_check_membership();
--> statement-breakpoint

-- Leaving an organization removes the person from its groups.
CREATE FUNCTION member_leave_groups() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM group_members g WHERE g.organization_id = OLD.organization_id AND g.user_id = OLD.user_id;
  RETURN OLD;
END
$$;
CREATE TRIGGER member_leave_groups AFTER DELETE ON member
  FOR EACH ROW EXECUTE FUNCTION member_leave_groups();
--> statement-breakpoint

-- The Developers group is created with its organization and lives as long as
-- it does: it cannot be deleted on its own or become an ordinary group.
CREATE FUNCTION groups_keep_developers() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_developers <> NEW.is_developers THEN
      RAISE EXCEPTION 'is_developers cannot change';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.is_developers AND EXISTS (SELECT 1 FROM organization o WHERE o.id = OLD.organization_id) THEN
    RAISE EXCEPTION 'the Developers group cannot be deleted';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER groups_keep_developers BEFORE UPDATE OR DELETE ON groups
  FOR EACH ROW EXECUTE FUNCTION groups_keep_developers();
