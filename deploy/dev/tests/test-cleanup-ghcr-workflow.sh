#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT_DIR
readonly WORKFLOW="${ROOT_DIR}/.github/workflows/cleanup-ghcr.yml"

fail() { printf 'cleanup workflow test failed: %s\n' "$*" >&2; exit 1; }
require_match() { grep -Eq -- "$1" "$WORKFLOW" || fail "missing required pattern: $1"; }
reject_match() {
  if grep -Eq -- "$1" "$WORKFLOW"; then
    fail "forbidden pattern: $1"
  fi
}

main() {
  local collect_script mock_bin
  TEST_TEMP_DIR="$(mktemp -d)"
  export TEST_TEMP_DIR
  trap 'rm -rf -- "$TEST_TEMP_DIR"' EXIT
  collect_script="$TEST_TEMP_DIR/collect-protected-digests.sh"
  mock_bin="$TEST_TEMP_DIR/bin"
  mkdir -p "$mock_bin"
  require_match 'cron: .0 3 \* \* 0.'
  require_match 'contents: read'
  require_match 'packages: write'
  require_match 'secrets\.GITHUB_TOKEN'
  require_match 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5'
  require_match 'api_path="/users/\$\{OWNER\}/packages/container/\$\{package\}/versions"'
  require_match 'per_page=100'
  require_match 'StrictHostKeyChecking=yes'
  require_match 'ssh -n -o BatchMode=yes'
  require_match 'for resource in deployments replicasets; do'
  require_match 'learning-platform-dev'
  require_match 'CANDIDATE_DIR:'
  require_match 'bash deploy/dev/delete-ghcr-versions\.sh'
  reject_match 'delete.*untagged|prune.*containerd|docker system prune|gh api.*--method DELETE|PAT'
  awk '
    /^      - name: Collect protected K3s image digests$/ { found = 1; next }
    found && /^        run: \|$/ { capture = 1; next }
    capture && /^      - name:/ { exit }
    capture { sub(/^          /, ""); print }
  ' "$WORKFLOW" > "$collect_script"
  [[ -s "$collect_script" ]] || fail 'protected digest collection step is missing'
  bash -n "$collect_script" || fail 'protected digest collection shell does not parse'
  cat > "$mock_bin/ssh" <<'EOF'
#!/usr/bin/env bash
remote_command="${*: -1}"
bash -n -c "$remote_command"
printf '%s\n' 'ghcr.io/sirobaby/learningplatform-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
EOF
  chmod 700 "$mock_bin/ssh"
  RUNNER_TEMP="$mock_bin" VPS_HOST=test-host VPS_USER=test-user \
    PATH="$mock_bin:$PATH" bash "$collect_script" \
    || fail 'protected digest collection command does not parse remotely'
  printf '%s\n' 'cleanup workflow static tests passed'
}

main "$@"
