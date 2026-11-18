#!/usr/bin/env bash
# Apply supabase/schema.sql (all sections, safe to re-run) to the local dev database.
# Uses psql inside the Supabase CLI's Postgres container, so no local psql is needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONTAINER="${DEV_DB_CONTAINER:-supabase_db_fintrack-dev}"
docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres < "$ROOT/supabase/schema.sql"
# Make PostgREST pick up new tables/functions immediately.
docker exec -i "$CONTAINER" psql -q -U postgres -d postgres -c "notify pgrst, 'reload schema';"
echo "schema.sql applied to $CONTAINER"
