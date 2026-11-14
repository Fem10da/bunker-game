#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir="${BUNKER_REPO_DIR:-/opt/bunker/repo}"
shared_dir="${BUNKER_SHARED_DIR:-/opt/bunker/shared}"
env_file="${BUNKER_ENV_FILE:-${shared_dir}/.env.production}"
compose_file="${repo_dir}/infra/vps/compose.yaml"
current_tag_file="${shared_dir}/current-image-tag"

fail() {
  printf '[bunker deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[bunker deploy] %s\n' "$*"
}

for command_name in docker git; do
  command -v "${command_name}" >/dev/null 2>&1 ||
    fail "${command_name} is not installed"
done

[[ -d "${repo_dir}/.git" ]] || fail "Git repository not found: ${repo_dir}"
[[ -f "${env_file}" ]] || fail "Production env not found: ${env_file}"
[[ -f "${compose_file}" ]] || fail "Compose file not found: ${compose_file}"

mkdir -p "${shared_dir}"
cd "${repo_dir}"

[[ -z "$(git status --porcelain)" ]] ||
  fail "VPS worktree is not clean; deployment stopped"

previous_sha="$(git rev-parse HEAD)"
previous_tag=""
if [[ -f "${current_tag_file}" ]]; then
  previous_tag="$(<"${current_tag_file}")"
fi

log "Fetching origin/main"
git fetch --prune origin main
git merge --ff-only origin/main

target_sha="$(git rev-parse --short=12 HEAD)"
log "Building backend image for ${target_sha}"

BUNKER_ENV_FILE="${env_file}" BUNKER_IMAGE_TAG="${target_sha}" \
  docker compose \
    --env-file "${env_file}" \
    --file "${compose_file}" \
    config --quiet

BUNKER_ENV_FILE="${env_file}" BUNKER_IMAGE_TAG="${target_sha}" \
  docker compose \
    --env-file "${env_file}" \
    --file "${compose_file}" \
    build --pull backend

log "Starting PostgreSQL and backend"
BUNKER_ENV_FILE="${env_file}" BUNKER_IMAGE_TAG="${target_sha}" \
  docker compose \
    --env-file "${env_file}" \
    --file "${compose_file}" \
    up --detach --remove-orphans postgres backend

backend_container="$(
  BUNKER_ENV_FILE="${env_file}" BUNKER_IMAGE_TAG="${target_sha}" \
    docker compose \
      --env-file "${env_file}" \
      --file "${compose_file}" \
      ps --quiet backend
)"

healthy=false
for _attempt in {1..30}; do
  status="$(
    docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      "${backend_container}" 2>/dev/null || true
  )"
  if [[ "${status}" == "healthy" ]]; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "${healthy}" == "true" ]]; then
  printf '%s\n' "${target_sha}" >"${current_tag_file}"
  log "Deployment ${target_sha} is healthy"
  exit 0
fi

log "Health check failed for ${target_sha}"
BUNKER_ENV_FILE="${env_file}" BUNKER_IMAGE_TAG="${target_sha}" \
  docker compose \
    --env-file "${env_file}" \
    --file "${compose_file}" \
    logs --tail 100 backend >&2 || true

if [[ -n "${previous_tag}" ]] &&
  docker image inspect "bunker-backend:${previous_tag}" >/dev/null 2>&1; then
  log "Rolling back the backend container to ${previous_tag}"
  BUNKER_ENV_FILE="${env_file}" BUNKER_IMAGE_TAG="${previous_tag}" \
    docker compose \
      --env-file "${env_file}" \
      --file "${compose_file}" \
      up --detach --no-deps backend
else
  log "No previous backend image is available for automatic rollback"
fi

fail "Deployment failed; Git advanced from ${previous_sha} to ${target_sha}"
