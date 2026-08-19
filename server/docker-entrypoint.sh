#!/bin/sh
# On first boot (empty volume) seed the default sources, then serve. The serve
# command's scheduler polls due sources immediately on startup.
set -e

if [ ! -f "$DB_PATH" ]; then
  echo "[entrypoint] first run — importing default seeds into $DB_PATH"
  node dist/entry.mjs import-opml seeds/reader.opml || true
  node dist/entry.mjs import-sources seeds/sources.json || true
fi

exec node dist/entry.mjs serve
