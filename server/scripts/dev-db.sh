#!/usr/bin/env bash
# Local PostgreSQL 16 for development/tests (no Docker needed). Data dir: $PGDATA_DIR (default ../.pgdata).
# Usage: scripts/dev-db.sh start|stop|status|reset
set -euo pipefail
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
DIR=${PGDATA_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/.pgdata}
PORT=${PGPORT_DEV:-5433}
RUN_AS=${PG_RUN_AS:-postgres}
as_pg() { if [ "$(id -u)" = 0 ]; then su "$RUN_AS" -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
case "${1:-start}" in
  start)
    if [ ! -f "$DIR/PG_VERSION" ]; then
      mkdir -p "$DIR"; [ "$(id -u)" = 0 ] && chown "$RUN_AS" "$DIR"
      as_pg "$BIN/initdb -D '$DIR' -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null"
      echo "listen_addresses='127.0.0.1'
port=$PORT
unix_socket_directories='/tmp'
fsync=off" >> "$DIR/postgresql.conf"
    fi
    as_pg "$BIN/pg_ctl -D '$DIR' -l '$DIR/server.log' -w start >/dev/null" && echo "postgres on 127.0.0.1:$PORT"
    ;;
  stop) as_pg "$BIN/pg_ctl -D '$DIR' -w stop -m fast" ;;
  status) as_pg "$BIN/pg_ctl -D '$DIR' status" ;;
  reset) "$0" stop || true; rm -rf "$DIR"; "$0" start ;;
esac
