#!/usr/bin/env bash
# Installs Postgres into the Cloud Agent image and creates the local cluster.
# The Build snapshot keeps this data directory. The server process does not
# survive the snapshot; `.cursor/start-postgres.sh` starts it with the VM.
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-client
fi

sudo service postgresql start

# Local-only role. This password is not a credential for any hosted database.
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preprocess') THEN
    CREATE ROLE preprocess WITH LOGIN PASSWORD 'preprocess' SUPERUSER;
  END IF;
END
$$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'preprocess'" | grep -q 1; then
  sudo -u postgres createdb --owner=preprocess preprocess
fi
