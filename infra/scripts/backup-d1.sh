#!/usr/bin/env bash
# VeilVPN D1 backup: exports the veil-vpn-db database to a timestamped SQL file.
# Usage: pnpm db:backup   (or: bash infra/scripts/backup-d1.sh)
# Output: infra/backups/veil-vpn-db-YYYYMMDD-HHMMSS.sql
#
# Prereqs: `wrangler` authenticated (`wrangler login`) with D1 read access.
# Keep exports off-repo or encrypted: they contain user emails/hashes.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="$ROOT/infra/backups"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/veil-vpn-db-$STAMP.sql"

mkdir -p "$BACKUP_DIR"

echo "[veil] exporting veil-vpn-db -> $OUT"
wrangler d1 export veil-vpn-db --output="$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[veil] backup complete: $OUT ($SIZE)"

# Retention: keep the newest 14 exports, delete older ones.
KEEP=14
COUNT="$(ls -1 "$BACKUP_DIR"/veil-vpn-db-*.sql 2>/dev/null | wc -l)"
if [ "$COUNT" -gt "$KEEP" ]; then
  ls -1 "$BACKUP_DIR"/veil-vpn-db-*.sql | sort | head -n "$((COUNT - KEEP))" | xargs rm -f
  echo "[veil] pruned old backups, kept newest $KEEP"
fi
