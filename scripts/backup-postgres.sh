#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir="${BUNKER_REPO_DIR:-/opt/bunker/repo}"
shared_dir="${BUNKER_SHARED_DIR:-/opt/bunker/shared}"
env_file="${BUNKER_ENV_FILE:-${shared_dir}/.env.production}"
backup_dir="${BUNKER_BACKUP_DIR:-${shared_dir}/backups}"
compose_file="${repo_dir}/infra/vps/compose.yaml"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${backup_dir}/bunker-${timestamp}.sql.gz"
temporary="${target}.partial"

[[ -f "${env_file}" ]] || {
  printf 'Production env not found: %s\n' "${env_file}" >&2
  exit 1
}

umask 077
mkdir -p "${backup_dir}"

set -a
source "${env_file}"
set +a

BUNKER_ENV_FILE="${env_file}" \
  docker compose \
    --env-file "${env_file}" \
    --file "${compose_file}" \
    exec --no-TTY postgres \
    pg_dump \
      --clean \
      --if-exists \
      --no-owner \
      --username "${POSTGRES_USER}" \
      "${POSTGRES_DB}" |
  gzip -9 >"${temporary}"

mv "${temporary}" "${target}"
printf 'Backup created: %s\n' "${target}"
