#!/usr/bin/env bash
# Isolated SQL fixture only. Never reads Supabase credentials or opens a host port.
set -euo pipefail
task_test_db="onside-review-jobs-test-$$"
trap 'docker stop "$task_test_db" >/dev/null 2>&1 || true' EXIT
docker run --name "$task_test_db" --rm -d -e POSTGRES_PASSWORD=local-review-test-only postgres:17-alpine >/dev/null
for attempt in {1..20}; do
  if docker exec "$task_test_db" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$task_test_db" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
create schema auth;
create table auth.users(id uuid primary key);
create role anon;
create role authenticated;
create role service_role bypassrls;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function public.is_admin() returns boolean language sql as $$ select coalesce(current_setting('request.jwt.claim.admin',true),'false')='true' $$;
SQL
docker exec -i "$task_test_db" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/0094_review_document_jobs.sql
docker exec -i "$task_test_db" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/0103_review_document_web_dispatcher.sql
docker exec -i "$task_test_db" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/0105_review_document_web_converters.sql
docker exec -i "$task_test_db" psql -U postgres -v ON_ERROR_STOP=1 < tests/sql/review-document-jobs.sql
docker exec -i "$task_test_db" psql -U postgres -v ON_ERROR_STOP=1 < tests/sql/review-document-web-jobs.sql
docker exec -i "$task_test_db" psql -U postgres -v ON_ERROR_STOP=1 < tests/sql/review-document-web-converters.sql
