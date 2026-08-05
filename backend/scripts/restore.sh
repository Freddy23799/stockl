#!/usr/bin/env bash
# Restaure une sauvegarde MACHIBEL (base + uploads) produite par backup.sh.
# ATTENTION : ecrase la base et les fichiers uploads/ actuels.
#
# Usage : ./scripts/restore.sh machibel_20260101_020000
# (le prefixe commun aux deux fichiers .sql.gz / .tar.gz d'une meme sauvegarde)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$BACKEND_DIR/../backups"

PREFIX="${1:-}"
if [ -z "$PREFIX" ]; then
  echo "Usage: ./scripts/restore.sh <prefixe>  (ex: machibel_20260101_020000)"
  echo "Sauvegardes disponibles :"
  ls -1 "$BACKUP_DIR" | sed -E 's/(machibel_[0-9_]+)\.(sql|uploads_[0-9_]+\.tar)\.gz/\1/' | sort -u
  exit 1
fi

DUMP_FILE="$BACKUP_DIR/${PREFIX}.sql.gz"
UPLOADS_FILE="$BACKUP_DIR/machibel_uploads_${PREFIX#machibel_}.tar.gz"

[ -f "$DUMP_FILE" ] || { echo "Introuvable: $DUMP_FILE"; exit 1; }

set -a
# shellcheck disable=SC1091
[ -f "$BACKEND_DIR/.env" ] && source "$BACKEND_DIR/.env"
set +a

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-machibel}"
DB_NAME="${DB_NAME:-machibel}"

read -p "Ecraser la base '$DB_NAME' et les uploads actuels ? (o/N) " confirm
[ "$confirm" = "o" ] || { echo "Annule."; exit 0; }

echo "Restauration de la base..."
if command -v psql >/dev/null 2>&1; then
  gunzip -c "$DUMP_FILE" | PGPASSWORD="${DB_PASSWORD:-}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx 'parfumerie-machibel-postgres-dev'; then
  gunzip -c "$DUMP_FILE" | docker exec -i parfumerie-machibel-postgres-dev psql -U "$DB_USER" -d "$DB_NAME"
else
  echo "ERREUR: psql introuvable (ni en local, ni via le conteneur de dev)." >&2
  exit 1
fi

if [ -f "$UPLOADS_FILE" ]; then
  echo "Restauration des uploads..."
  rm -rf "$BACKEND_DIR/uploads"
  tar -xzf "$UPLOADS_FILE" -C "$BACKEND_DIR"
else
  echo "Attention: fichier uploads introuvable ($UPLOADS_FILE), non restaure."
fi

echo "Restauration terminee."
