#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT_DIR
readonly DEPLOY_SCRIPT="${ROOT_DIR}/deploy/dev/deploy.sh"
readonly API_DIGEST_A="ghcr.io/sirobaby/learningplatform-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
readonly WORKER_DIGEST_A="ghcr.io/sirobaby/learningplatform-api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
readonly BACKEND_DIGEST_B="ghcr.io/sirobaby/learningplatform-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
readonly WEB_DIGEST_A="ghcr.io/sirobaby/learningplatform-web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
readonly WEB_DIGEST_B="ghcr.io/sirobaby/learningplatform-web@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

fail() {
  printf 'test failed: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fqx -- "${expected}" "${file}" || fail "missing ${expected}"
}

assert_selected_operations() {
  local log_file="$1"
  local selected_services="$2"
  local service operation
  for service in web api worker; do
    if [[ ",${selected_services}," == *",${service},"* ]]; then
      for operation in pull 'up -d'; do
        grep -Eq "compose ${operation}( [a-z]+)* ${service}( |$)|compose ${operation} ${service}( |$)" "${log_file}" || fail "${service} ${operation} missing"
      done
    elif grep -Fq " ${service}" "${log_file}"; then
      fail "unselected ${service} was operated"
    fi
  done
}

write_mock_commands() {
  local bin_dir="$1"
  mkdir -p "${bin_dir}"
  cat > "${bin_dir}/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${TEST_LOG}"
if [[ "$1" == compose ]]; then
  shift
  while [[ "$1" == --* || "$1" == -f ]]; do
    if [[ "$1" == --project-directory || "$1" == --env-file || "$1" == -f ]]; then shift 2; else shift; fi
  done
  [[ "$1" == ps ]] && { printf 'container-%s\n' "$3"; exit 0; }
  printf 'compose %s\n' "$*" >> "${TEST_LOG}"
  exit 0
fi
[[ "$1" == inspect ]] && { printf '%s\n' "${TEST_HEALTH:-healthy}"; exit 0; }
exit 0
EOF
  cat > "${bin_dir}/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "${bin_dir}/stat" <<'EOF'
#!/usr/bin/env bash
printf '600\n'
EOF
  cat > "${bin_dir}/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod 700 "${bin_dir}"/*
}

prepare_deploy_dir() {
  local deploy_dir="$1"
  mkdir -p "${deploy_dir}/../env"
  cp "${ROOT_DIR}/deploy/dev/compose.yml" "${deploy_dir}/compose.yml"
  : > "${deploy_dir}/../env/web.env"
  : > "${deploy_dir}/../env/api.env"
  : > "${deploy_dir}/../env/worker.env"
  cat > "${deploy_dir}/.release.env" <<EOF
DEPLOY_BIND_ADDRESS=127.0.0.1
WEB_IMAGE=${WEB_DIGEST_A}
API_IMAGE=${API_DIGEST_A}
WORKER_IMAGE=${WORKER_DIGEST_A}
EOF
}

run_deploy() {
  local deploy_dir="$1"
  shift
  TEST_HEALTH=healthy DEPLOY_DIR="${deploy_dir}" HEALTH_TIMEOUT_SECONDS=1 PATH="${MOCK_BIN}:${PATH}" TEST_LOG="${TEST_LOG}" \
    bash "${DEPLOY_SCRIPT}" "$@" --ghcr-username test <<< token
}

assert_release() {
  local deploy_dir="$1"
  local web_image="$2"
  local api_image="$3"
  local worker_image="$4"
  assert_contains "${deploy_dir}/.release.env" "WEB_IMAGE=${web_image}"
  assert_contains "${deploy_dir}/.release.env" "API_IMAGE=${api_image}"
  assert_contains "${deploy_dir}/.release.env" "WORKER_IMAGE=${worker_image}"
}

assert_no_docker_operations() {
  local log_file="$1"
  [[ ! -s "${log_file}" ]] || fail 'incomplete first deploy invoked Docker'
}

main() {
  local temp_dir deploy_dir
  temp_dir="$(mktemp -d)"
  trap 'rm -rf -- "${temp_dir:-}"' EXIT
  MOCK_BIN="${temp_dir}/bin"
  TEST_LOG="${temp_dir}/operations.log"
  export MOCK_BIN TEST_LOG
  write_mock_commands "${MOCK_BIN}"
  deploy_dir="${temp_dir}/deploy/dev"
  prepare_deploy_dir "${deploy_dir}"
  run_deploy "${deploy_dir}" --services web --web-image "${WEB_DIGEST_B}"
  assert_release "${deploy_dir}" "${WEB_DIGEST_B}" "${API_DIGEST_A}" "${WORKER_DIGEST_A}"
  assert_selected_operations "${TEST_LOG}" web

  : > "${TEST_LOG}"
  prepare_deploy_dir "${deploy_dir}"
  run_deploy "${deploy_dir}" --services api --api-image "${BACKEND_DIGEST_B}"
  assert_release "${deploy_dir}" "${WEB_DIGEST_A}" "${BACKEND_DIGEST_B}" "${WORKER_DIGEST_A}"
  assert_selected_operations "${TEST_LOG}" api

  : > "${TEST_LOG}"
  prepare_deploy_dir "${deploy_dir}"
  run_deploy "${deploy_dir}" --services worker --worker-image "${BACKEND_DIGEST_B}"
  assert_release "${deploy_dir}" "${WEB_DIGEST_A}" "${API_DIGEST_A}" "${BACKEND_DIGEST_B}"
  assert_selected_operations "${TEST_LOG}" worker

  : > "${TEST_LOG}"
  prepare_deploy_dir "${deploy_dir}"
  run_deploy "${deploy_dir}" --services web,api,worker --web-image "${WEB_DIGEST_B}" --api-image "${BACKEND_DIGEST_B}" --worker-image "${BACKEND_DIGEST_B}"
  assert_release "${deploy_dir}" "${WEB_DIGEST_B}" "${BACKEND_DIGEST_B}" "${BACKEND_DIGEST_B}"
  assert_selected_operations "${TEST_LOG}" web,api,worker

  : > "${TEST_LOG}"
  prepare_deploy_dir "${deploy_dir}"
  if TEST_HEALTH=unhealthy DEPLOY_DIR="${deploy_dir}" HEALTH_TIMEOUT_SECONDS=0 PATH="${MOCK_BIN}:${PATH}" TEST_LOG="${TEST_LOG}" bash "${DEPLOY_SCRIPT}" --services worker --worker-image "${BACKEND_DIGEST_B}" --ghcr-username test <<< token; then
    fail 'unhealthy worker deployment unexpectedly succeeded'
  fi
  assert_release "${deploy_dir}" "${WEB_DIGEST_A}" "${API_DIGEST_A}" "${WORKER_DIGEST_A}"
  assert_selected_operations "${TEST_LOG}" worker

  : > "${TEST_LOG}"
  rm -f -- "${deploy_dir}/.release.env"
  if DEPLOY_DIR="${deploy_dir}" PATH="${MOCK_BIN}:${PATH}" TEST_LOG="${TEST_LOG}" bash "${DEPLOY_SCRIPT}" --services api --api-image "${BACKEND_DIGEST_B}" --ghcr-username test <<< token; then
    fail 'incomplete first deployment unexpectedly succeeded'
  fi
  [[ ! -f "${deploy_dir}/.release.env" ]] || fail 'incomplete first deployment wrote release state'
  assert_no_docker_operations "${TEST_LOG}"
  printf '%s\n' 'selective deploy state tests passed'
}

main "$@"
