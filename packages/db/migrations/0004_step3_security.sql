-- Grants and row-level security for the step 3 tables (design docs 04 to 06),
-- the same rules as migrations/0001_security.sql.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  idempotency_keys, files, review_events, case_mentions, inbox_reads, outbox,
  webhook_endpoints, webhook_deliveries
  TO preprocess_app, preprocess_system;
--> statement-breakpoint

-- Review events are a record of what people did: never edited. They go only
-- when their case does (the cascade runs as the table owner).
REVOKE UPDATE ON review_events FROM preprocess_app, preprocess_system;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'idempotency_keys', 'files', 'review_events', 'case_mentions', 'inbox_reads',
    'outbox', 'webhook_endpoints', 'webhook_deliveries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (organization_id = current_setting(''app.org_id'', true)) WITH CHECK (organization_id = current_setting(''app.org_id'', true))',
      t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- An inbox read belongs to a member of the organization.
CREATE FUNCTION inbox_reads_check_membership() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER inbox_reads_membership BEFORE INSERT OR UPDATE ON inbox_reads
  FOR EACH ROW EXECUTE FUNCTION inbox_reads_check_membership();
--> statement-breakpoint

-- A group named in a case thread stays while the organization does.
CREATE FUNCTION groups_keep_mentioned() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM organization o WHERE o.id = OLD.organization_id)
     AND EXISTS (SELECT 1 FROM case_mentions m WHERE m.organization_id = OLD.organization_id AND m.group_id = OLD.id) THEN
    RAISE EXCEPTION 'group % is mentioned in a case: deleting it would break a foreign key', OLD.slug
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER groups_keep_mentioned BEFORE DELETE ON groups
  FOR EACH ROW EXECUTE FUNCTION groups_keep_mentioned();
