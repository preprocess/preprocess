-- Seed data for local development and every preview branch. Idempotent, so it
-- can be re-applied after a reset.
--
-- Organizations, people and their audit chains are created through the API
-- (Better Auth hashes passwords, and the chain is hashed in code), so this
-- file holds nothing yet; `pnpm db:seed` also runs the API's seed.
SELECT 1;
