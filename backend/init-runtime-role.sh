#!/bin/sh
set -eu

: "${KIMS_APP_PASSWORD:?KIMS_APP_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_password="$KIMS_APP_PASSWORD" <<'SQL'
CREATE ROLE kims_runtime LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE kims_smis TO kims_runtime;
SQL
