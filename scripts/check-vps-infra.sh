#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${repo_dir}/infra/vps/compose.yaml"
example_env="${repo_dir}/infra/vps/.env.production.example"
backup_service="${repo_dir}/infra/vps/systemd/bunker-postgres-backup.service"
backup_timer="${repo_dir}/infra/vps/systemd/bunker-postgres-backup.timer"

bash -n "${repo_dir}/scripts/deploy-vps.sh"
bash -n "${repo_dir}/scripts/backup-postgres.sh"
[[ -s "${backup_service}" ]]
[[ -s "${backup_timer}" ]]

BUNKER_ENV_FILE="${example_env}" \
  docker compose \
    --env-file "${example_env}" \
    --file "${compose_file}" \
    config --quiet

echo "VPS infrastructure configuration is valid."
