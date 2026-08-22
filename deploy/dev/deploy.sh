#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEPLOY_DIR="${DEPLOY_DIR:-/opt/learning-platform/deploy/dev}"
readonly ENV_DIR="${DEPLOY_DIR}/../env"
readonly COMPOSE_FILE="${DEPLOY_DIR}/compose.yml"
readonly RELEASE_FILE="${DEPLOY_DIR}/.release.env"
readonly PREVIOUS_RELEASE_FILE="${DEPLOY_DIR}/.release.previous.env"
readonly LOCK_FILE="${DEPLOY_DIR}/.deploy.lock"
readonly HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
readonly REQUIRED_ENV_FILES=("${ENV_DIR}/web.env" "${ENV_DIR}/api.env" "${ENV_DIR}/worker.env")

fail() {
  printf '%s\n' "deploy failed: $*" >&2
  exit 1
}

validate_deploy_dir() {
  [[ "${DEPLOY_DIR}" = /* ]] || fail "DEPLOY_DIR must be an absolute path"
  [[ "${DEPLOY_DIR}" != *$'\n'* && "${DEPLOY_DIR}" != *$'\r'* && "${DEPLOY_DIR}" != *$'\t'* ]] || fail "DEPLOY_DIR must not contain control characters"
  [[ "${DEPLOY_DIR}" =~ ^/[A-Za-z0-9._~/-]+$ ]] || fail "DEPLOY_DIR contains unsupported characters"
  [[ "${DEPLOY_DIR}" != *//* && "${DEPLOY_DIR}" != */../* && "${DEPLOY_DIR}" != */.. ]] || fail "DEPLOY_DIR must not contain ambiguous path segments"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

require_immutable_image() {
  [[ "$1" =~ ^ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$ ]] || fail "image reference must be an immutable lowercase GHCR digest"
}

validate_runtime_files() {
  local env_file
  for env_file in "${REQUIRED_ENV_FILES[@]}"; do
    [[ -f "${env_file}" ]] || fail "missing pre-provisioned runtime environment file: ${env_file}"
    [[ ! -L "${env_file}" ]] || fail "runtime environment file must not be a symlink: ${env_file}"
    [[ "$(stat -c '%a' "${env_file}")" == "600" ]] || fail "runtime environment file must be chmod 600: ${env_file}"
  done
}

compose() {
  docker compose --project-directory "${DEPLOY_DIR}" --env-file "${RELEASE_FILE}" -f "${COMPOSE_FILE}" "$@"
}

contains_service() {
  local expected="$1"
  local service
  for service in "${SELECTED_SERVICES[@]}"; do
    [[ "${service}" == "${expected}" ]] && return 0
  done
  return 1
}

wait_for_healthy_services() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  local service container health
  while (( SECONDS < deadline )); do
    local all_healthy=true
    for service in "${SELECTED_SERVICES[@]}"; do
      container="$(compose ps -q "${service}")"
      if [[ -z "${container}" ]]; then
        all_healthy=false
        break
      fi
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "${container}")"
      if [[ "${health}" != "healthy" ]]; then
        all_healthy=false
        break
      fi
    done
    if [[ "${all_healthy}" == true ]]; then
      return 0
    fi
    sleep 5
  done
  return 1
}

release_value() {
  local release_file="$1"
  local key="$2"
  awk -F= -v key="${key}" '$1 == key { print substr($0, length(key) + 2); exit }' "${release_file}"
}

require_complete_release() {
  local release_file="$1"
  local key value
  for key in WEB_IMAGE API_IMAGE WORKER_IMAGE; do
    value="$(release_value "${release_file}" "${key}")"
    [[ -n "${value}" ]] || fail "release state is missing ${key}"
    require_immutable_image "${value}"
  done
}

write_candidate_release() {
  local candidate_file="$1"
  local previous_file="$2"
  local web_image="${WEB_IMAGE:-}"
  local api_image="${API_IMAGE:-}"
  local worker_image="${WORKER_IMAGE:-}"

  if [[ -n "${previous_file}" ]]; then
    require_complete_release "${previous_file}"
    web_image="$(release_value "${previous_file}" WEB_IMAGE)"
    api_image="$(release_value "${previous_file}" API_IMAGE)"
    worker_image="$(release_value "${previous_file}" WORKER_IMAGE)"
  else
    if ! contains_service web || ! contains_service api || ! contains_service worker; then
      fail "first deployment must select web, api, and worker"
    fi
  fi

  contains_service web && web_image="${NEW_WEB_IMAGE}"
  contains_service api && api_image="${NEW_API_IMAGE}"
  contains_service worker && worker_image="${NEW_WORKER_IMAGE}"

  require_immutable_image "${web_image}"
  require_immutable_image "${api_image}"
  require_immutable_image "${worker_image}"
  {
    printf 'DEPLOY_BIND_ADDRESS=%s\n' "${DEPLOY_BIND_ADDRESS:-127.0.0.1}"
    printf 'WEB_IMAGE=%s\n' "${web_image}"
    printf 'API_IMAGE=%s\n' "${api_image}"
    printf 'WORKER_IMAGE=%s\n' "${worker_image}"
  } > "${candidate_file}"
}

rollback() {
  local previous_file="$1"
  if [[ -n "${previous_file}" && -f "${previous_file}" ]]; then
    cp -- "${previous_file}" "${RELEASE_FILE}"
    compose config -q
    compose pull "${SELECTED_SERVICES[@]}"
    compose up -d "${SELECTED_SERVICES[@]}"
    wait_for_healthy_services || printf '%s\n' "rollback did not become healthy" >&2
    return
  fi

  compose rm --stop --force "${SELECTED_SERVICES[@]}" || true
  rm -f -- "${RELEASE_FILE}"
  printf '%s\n' "rollback skipped: no previous release exists; removed selected failed candidate containers" >&2
}

on_failure() {
  local exit_code="$?"
  trap - ERR
  printf '%s\n' "deployment failed; attempting rollback" >&2
  rollback "${CURRENT_RELEASE_BACKUP_FILE:-}" || true
  exit "${exit_code}"
}

parse_services() {
  local services_csv="$1"
  local service
  IFS=',' read -r -a SELECTED_SERVICES <<< "${services_csv}"
  ((${#SELECTED_SERVICES[@]} > 0)) || fail "at least one service must be selected"
  for service in "${SELECTED_SERVICES[@]}"; do
    case "${service}" in web|api|worker) ;; *) fail "unsupported selected service: ${service}" ;; esac
  done
  [[ " $(printf ' %s' "${SELECTED_SERVICES[@]}") " != *" web web "* ]] || fail "selected services must not contain duplicates"
  [[ " $(printf ' %s' "${SELECTED_SERVICES[@]}") " != *" api api "* ]] || fail "selected services must not contain duplicates"
  [[ " $(printf ' %s' "${SELECTED_SERVICES[@]}") " != *" worker worker "* ]] || fail "selected services must not contain duplicates"
}

require_selected_image() {
  local service="$1"
  local image="$2"
  if contains_service "${service}"; then
    [[ -n "${image}" ]] || fail "missing selected ${service} image digest"
    require_immutable_image "${image}"
  fi
}

main() {
  local services_csv=''
  local ghcr_username=''
  NEW_WEB_IMAGE="${WEB_IMAGE:-}"
  NEW_API_IMAGE="${API_IMAGE:-}"
  NEW_WORKER_IMAGE="${WORKER_IMAGE:-}"
  while (($#)); do
    case "$1" in
      --services) services_csv="$2"; shift 2 ;;
      --web-image) NEW_WEB_IMAGE="$2"; shift 2 ;;
      --api-image) NEW_API_IMAGE="$2"; shift 2 ;;
      --worker-image) NEW_WORKER_IMAGE="$2"; shift 2 ;;
      --ghcr-username) ghcr_username="$2"; shift 2 ;;
      *) fail "unknown argument: $1" ;;
    esac
  done
  [[ -n "${services_csv}" && -n "${ghcr_username}" ]] || fail "usage: deploy.sh --services <web,api,worker> --ghcr-username <username> [--web-image <digest>] [--api-image <digest>] [--worker-image <digest>]"
  parse_services "${services_csv}"
  require_selected_image web "${NEW_WEB_IMAGE}"
  require_selected_image api "${NEW_API_IMAGE}"
  require_selected_image worker "${NEW_WORKER_IMAGE}"

  local ghcr_token
  IFS= read -r ghcr_token || fail "GHCR token was not provided on standard input"
  require_command docker
  require_command flock
  require_command stat
  validate_deploy_dir
  [[ -f "${COMPOSE_FILE}" ]] || fail "missing compose file: ${COMPOSE_FILE}"
  [[ -n "${ghcr_username}" && -n "${ghcr_token}" ]] || fail "GHCR credentials are required"
  validate_runtime_files

  mkdir -p "${DEPLOY_DIR}"
  exec 9>"${LOCK_FILE}"
  flock -n 9 || fail "another deployment is already running"
  umask 077

  local candidate_release
  local current_release_backup=''
  candidate_release="$(mktemp "${DEPLOY_DIR}/.release.candidate.XXXXXX")"
  if [[ -f "${RELEASE_FILE}" ]]; then
    current_release_backup="$(mktemp "${DEPLOY_DIR}/.release.rollback.XXXXXX")"
    cp -- "${RELEASE_FILE}" "${current_release_backup}"
  fi
  trap 'rm -f -- "${candidate_release:-}" "${current_release_backup:-}"' EXIT
  write_candidate_release "${candidate_release}" "${current_release_backup}"
  CURRENT_RELEASE_BACKUP_FILE="${current_release_backup}"
  mv -- "${candidate_release}" "${RELEASE_FILE}"
  trap on_failure ERR

  printf '%s' "${ghcr_token}" | docker login ghcr.io --username "${ghcr_username}" --password-stdin >/dev/null
  compose config -q
  compose pull "${SELECTED_SERVICES[@]}"
  compose up -d "${SELECTED_SERVICES[@]}"
  if ! wait_for_healthy_services; then
    printf '%s\n' "deploy failed: selected services did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s" >&2
    trap - ERR
    rollback "${current_release_backup}" || true
    exit 1
  fi
  if [[ -n "${current_release_backup}" && -f "${current_release_backup}" ]]; then
    cp -- "${current_release_backup}" "${PREVIOUS_RELEASE_FILE}"
  else
    rm -f -- "${PREVIOUS_RELEASE_FILE}"
  fi
  printf '%s\n' "deployment completed"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
