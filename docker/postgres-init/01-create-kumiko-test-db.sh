#!/bin/bash
set -euo pipefail

# kumiko_dev is POSTGRES_DB; tests also need a stable kumiko_test database
# (see TEST_DATABASE_URL in test-setup/integration.preload.ts).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE DATABASE kumiko_test;
EOSQL
