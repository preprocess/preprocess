-- Seed data for local and every preview branch. Idempotent, so it can be
-- re-applied after a reset.
INSERT INTO organizations (id, name) VALUES
  ('org_acme', 'Acme Logistics'),
  ('org_globex', 'Globex Insurance')
ON CONFLICT (id) DO NOTHING;

INSERT INTO members (id, organization_id, email, role) VALUES
  ('mem_acme_owner', 'org_acme', 'owner@acme.test', 'owner'),
  ('mem_acme_admin', 'org_acme', 'admin@acme.test', 'admin'),
  ('mem_globex_owner', 'org_globex', 'owner@globex.test', 'owner')
ON CONFLICT (id) DO NOTHING;
