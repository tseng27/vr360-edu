#!/usr/bin/env bash
# 本機資料庫權限測試。需要 psql 與一個可連線的 PostgreSQL 15+（不需要 Supabase CLI）。
# 用法：PGHOST=... PGPORT=... PGUSER=postgres bash supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=classroom_test_$$
psql -v ON_ERROR_STOP=1 -q -c "create database $DB" >/dev/null
trap 'psql -q -c "drop database if exists $DB" >/dev/null' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/supabase_stubs.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/20261112000000_classroom.sql 2>/dev/null >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/classroom_test.sql 2>&1 | grep -v '^$' | sed -E 's/^psql:[^:]+:[0-9]+: //'
