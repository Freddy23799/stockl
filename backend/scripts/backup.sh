#!/usr/bin/env bash
# Sauvegarde complete MACHIBEL : base PostgreSQL + fichiers uploads/ (photos
# produits, logo boutique). Les deux DOIVENT etre sauvegardes ensemble : la
# base ne stocke que les chemins des photos, jamais les fichiers eux-memes.
#
# Usage :
#   ./scripts/backup.sh                    # sauvegarde dans ../backups/
#   ./scripts/backup.sh /chemin/personnalise
#
# Prevu pour tourner via une tache planifiee quotidienne :
#   - Windows (prod)  : Planificateur de taches -> declenche ce script (via WSL/Git Bash) ou son equivalent .bat
#   - Linux/dev        : cron -> `0 2 * * * cd /chemin/backend && ./scripts/backup.sh`
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${1:-$BACKEND_DIR/../backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

set -a
# shellcheck disable=SC1091
[ -f "$BACKEND_DIR/.env" ] && source "$BACKEND_DIR/.env"
set +a

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5439}"
DB_USER="${DB_USER:-machibel}"
DB_NAME="${DB_NAME:-machibel}"

mkdir -p "$BACKUP_DIR"

DUMP_FILE="$BACKUP_DIR/machibel_${TIMESTAMP}.sql.gz"
UPLOADS_FILE="$BACKUP_DIR/machibel_uploads_${TIMESTAMP}.tar.gz"

echo "Sauvegarde de la base ($DB_NAME sur $DB_HOST:$DB_PORT)..."
if command -v pg_dump >/dev/null 2>&1; then
  # Chemin production : PostgreSQL natif, pg_dump dans le PATH
  PGPASSWORD="${DB_PASSWORD:-}" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" | gzip > "$DUMP_FILE"
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx 'parfumerie-machibel-postgres-dev'; then
  # Confort de dev uniquement : pg_dump absent en local, on passe par le conteneur (voir docker-compose.yml)
  docker exec parfumerie-machibel-postgres-dev pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$DUMP_FILE"
else
  echo "ERREUR: pg_dump introuvable (ni en local, ni via le conteneur de dev)." >&2
  exit 1
fi
echo "  -> $DUMP_FILE"

echo "Sauvegarde des fichiers uploads/..."
tar -czf "$UPLOADS_FILE" -C "$BACKEND_DIR" uploads
echo "  -> $UPLOADS_FILE"

# Conserve les 30 derniers jours de sauvegardes, supprime le reste
find "$BACKUP_DIR" -name 'machibel_*.gz' -mtime +30 -delete

echo "Sauvegarde terminee."
