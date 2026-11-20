#!/usr/bin/env bash
# Fresh local PostgreSQL only. Never reads a production URL or credentials.
set -euo pipefail
read_policies_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
read_policies_container_id=""
cleanup_read_policies() {
  if [[ -n "$read_policies_container_id" ]]; then
    docker rm --force "$read_policies_container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup_read_policies EXIT
read_policies_container_id="$(docker run --rm --detach --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
read_policies_ready=false
# Over TCP: the image's init-time server listens on the socket only and is
# restarted before the real one starts.
for read_policies_attempt in {1..120}; do
  if docker exec "$read_policies_container_id" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    read_policies_ready=true
    break
  fi
  sleep 1
done
if [[ "$read_policies_ready" != true ]]; then
  echo "Isolated PostgreSQL did not become ready." >&2
  exit 1
fi
read_policies_psql() {
  docker exec --interactive "$read_policies_container_id" psql -X -U postgres --set ON_ERROR_STOP=1 --quiet
}
read_policies_psql < "$read_policies_root/tests/sql/read-policies-bootstrap.sql"
for read_policies_migration in \
  0051_credit_rewards.sql \
  0054_credit_studio_reservations.sql \
  0061_magazine_artwork_bucket.sql \
  0063_support_inquiries.sql \
  20261121100000_magazine_artwork_no_public_listing.sql \
  20261121101000_staff_memos_not_owner_readable.sql; do
  read_policies_psql < "$read_policies_root/supabase/migrations/$read_policies_migration"
done
read_policies_psql < "$read_policies_root/tests/sql/read-policies.sql"
echo "Read policy SQL checks passed; disposable container will be removed."
