#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT_DIR
readonly DELETE_SCRIPT="${ROOT_DIR}/deploy/dev/delete-ghcr-versions.sh"

fail() { printf 'delete test failed: %s\n' "$*" >&2; exit 1; }

main() {
  local temp_dir candidates mock_bin output
  temp_dir="$(mktemp -d)"
  trap 'rm -rf -- "${temp_dir:-}"' EXIT
  candidates="${temp_dir}/candidates"
  mock_bin="${temp_dir}/bin"
  mkdir -p "${candidates}" "${mock_bin}"
  printf '%s\n' 101 > "${candidates}/learningplatform-api-delete-ids"
  printf '%s\n' 202 > "${candidates}/learningplatform-web-delete-ids"
  cat > "${mock_bin}/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${CURL_LOG}"
EOF
  chmod 700 "${mock_bin}/curl"
  : > "${temp_dir}/curl.log"

  output="$(CANDIDATE_DIR="${candidates}" EVENT_NAME=workflow_dispatch \
    CURL_LOG="${temp_dir}/curl.log" PATH="${mock_bin}:${PATH}" \
    bash "${DELETE_SCRIPT}")"
  [[ "${output}" == $'manual run is dry-run; type DELETE in confirmation to delete\n101\n202' ]] \
    || fail 'manual dry-run did not report exact candidates'
  [[ ! -s "${temp_dir}/curl.log" ]] || fail 'manual dry-run invoked DELETE'

  CANDIDATE_DIR="${candidates}" EVENT_NAME=schedule GITHUB_TOKEN=test-token \
    CURL_LOG="${temp_dir}/curl.log" PATH="${mock_bin}:${PATH}" \
    bash "${DELETE_SCRIPT}"
  grep -Fq 'https://api.github.com/user/packages/container/learningplatform-api/versions/101' "${temp_dir}/curl.log" \
    || fail 'scheduled API deletion did not use the exact version endpoint'
  grep -Fq 'https://api.github.com/user/packages/container/learningplatform-web/versions/202' "${temp_dir}/curl.log" \
    || fail 'scheduled web deletion did not use the exact version endpoint'
  [[ "$(grep -Fc -- '-X DELETE' "${temp_dir}/curl.log")" == 2 ]] \
    || fail 'scheduled cleanup did not issue exactly two DELETE requests'

  printf '%s\n' '../bad' > "${candidates}/learningplatform-api-delete-ids"
  if CANDIDATE_DIR="${candidates}" EVENT_NAME=schedule GITHUB_TOKEN=test-token \
    CURL_LOG="${temp_dir}/curl.log" PATH="${mock_bin}:${PATH}" \
    bash "${DELETE_SCRIPT}" >/dev/null 2>&1; then
    fail 'invalid selector output did not fail closed'
  fi
  printf '%s\n' 'GHCR delete behavior tests passed'
}

main "$@"
