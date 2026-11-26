-- Spec 1.5 retired Inkling 2 Mini and Inkling 2 Small. Stored settings and
-- deployment manifests that name them move to DeepSeek V4.1 Flash, the model
-- the platform already runs them on since preprocess#101, which reads both the
-- retired and the new ids. Safe on that release and on a rollback to it; it is
-- not safe on a release before #101, so this ships after #101 has deployed.
-- Data only: the migrator owns these tables, so lifting FORCE for this
-- transaction lets it see every organization's rows.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organization_defaults', 'agent_overrides', 'deployments'] LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  UPDATE organization_defaults
    SET "values" = jsonb_set("values", '{model}', '"deepseek-v4.1-flash"')
    WHERE "values"->>'model' IN ('inkling-2-mini', 'inkling-2-small');
  UPDATE agent_overrides
    SET "values" = jsonb_set("values", '{model}', '"deepseek-v4.1-flash"')
    WHERE "values"->>'model' IN ('inkling-2-mini', 'inkling-2-small');
  UPDATE deployments
    SET manifest = jsonb_set(manifest, '{model}', '"deepseek-v4.1-flash"')
    WHERE manifest->>'model' IN ('inkling-2-mini', 'inkling-2-small');

  FOREACH t IN ARRAY ARRAY['organization_defaults', 'agent_overrides', 'deployments'] LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
