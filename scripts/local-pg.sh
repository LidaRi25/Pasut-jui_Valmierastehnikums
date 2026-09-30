#!/usr/bin/env bash
# Lokāls PostgreSQL datubāzes testiem BEZ Docker (izmanto sistēmā uzstādīto PostgreSQL 15+).
#   bash scripts/local-pg.sh start   — inicializē (ja vajag) un palaiž serveri uz 127.0.0.1:54322
#   bash scripts/local-pg.sh stop    — aptur serveri
#   bash scripts/local-pg.sh env     — izdrukā TEST_DATABASE_URL
# Pēc start:  export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54322/postgres && npm run test:db
set -euo pipefail

PORT="${VT_PG_PORT:-54322}"
if [ -n "${PG_BIN:-}" ]; then
  BIN="$PG_BIN"
elif command -v pg_ctl >/dev/null 2>&1; then
  BIN="$(dirname "$(command -v pg_ctl)")"
else
  BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
fi
if [ -z "${BIN:-}" ] || [ ! -x "$BIN/pg_ctl" ]; then
  echo "Nav atrasts PostgreSQL (pg_ctl). Uzstādiet PostgreSQL 15+ vai norādiet PG_BIN=/ceļš/uz/bin" >&2
  exit 1
fi

if [ "$(id -u)" = "0" ]; then
  # PostgreSQL neatļauj darboties kā root — izmantojam lietotāju postgres
  DATA="${VT_PG_DATA:-/var/lib/vt-pg/data}"
  RUN=(su postgres -c)
  mkdir -p "$(dirname "$DATA")" && chown postgres:postgres "$(dirname "$DATA")"
else
  DATA="${VT_PG_DATA:-$HOME/.vt-local-pg/data}"
  RUN=(bash -c)
  mkdir -p "$(dirname "$DATA")"
fi
LOG="$(dirname "$DATA")/postgres.log"

run() { "${RUN[@]}" "$1"; }

case "${1:-start}" in
  start)
    if [ ! -d "$DATA" ]; then
      run "'$BIN/initdb' -D '$DATA' -E UTF8 --locale=C.UTF-8 -A trust >/dev/null"
      run "printf \"port = $PORT\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = '/tmp'\nfsync = off\nsynchronous_commit = off\nfull_page_writes = off\n\" >> '$DATA/postgresql.conf'"
    fi
    run "'$BIN/pg_ctl' -D '$DATA' -l '$LOG' -w start" || true
    echo "PostgreSQL darbojas uz 127.0.0.1:$PORT"
    echo "export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  stop)
    run "'$BIN/pg_ctl' -D '$DATA' -m fast stop" || true
    ;;
  env)
    echo "export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  *)
    echo "Lietošana: local-pg.sh start|stop|env" >&2
    exit 1
    ;;
esac
