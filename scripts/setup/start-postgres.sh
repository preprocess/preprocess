#!/usr/bin/env bash
# Starts the VM-local Postgres cluster for a Cloud Agent session.
set -euo pipefail

sudo service postgresql start

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if sudo -u postgres pg_isready --quiet; then
    exit 0
  fi
  sleep 0.5
done

echo "Postgres did not accept connections." >&2
exit 1
