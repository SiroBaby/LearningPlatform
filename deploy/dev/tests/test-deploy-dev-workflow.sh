#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT_DIR
readonly WORKFLOW="${ROOT_DIR}/.github/workflows/deploy-dev.yml"

fail() {
  printf 'workflow test failed: %s\n' "$*" >&2
  exit 1
}

require_match() {
  grep -Eq -- "$1" "${WORKFLOW}" || fail "missing required pattern: $1"
}

reject_match() {
  if grep -Eq -- "$1" "${WORKFLOW}"; then
    fail "forbidden pattern: $1"
  fi
}

main() {
  require_match 'ansible-core==2\.21\.2'
  require_match 'node \.\./deploy/dev/audit-high\.js'
  require_match 'ansible-galaxy.*collection install -r infra/ansible/requirements\.yml'
  require_match 'site\.yml --tags cert_manager,applications'
  reject_match 'DEV_K3S_ANSIBLE_VARS_B64|ANSIBLE_VARS_B64|base64 --decode'
  require_match 'k3s kubectl rollout status deployment/'
  require_match 'StrictHostKeyChecking=yes'
  require_match 'VPS_HOST and VPS_USER must be non-empty'
  require_match 'site\.yml --tags k3s,external_secrets,observability'
  require_match 'if: always\(\)'
  require_match "github\.ref == 'refs/heads/develop' && \(github\.event_name == 'push' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.target == 'observability'\)\)"
  require_match "github\.event_name == 'workflow_dispatch' && github\.ref == 'refs/heads/develop' && inputs\.target == 'observability-health'"
  require_match 'deploy/dev/observability-health\.sh'
  require_match 'while IFS= read -r target; do'
  require_match 'ssh -n -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="\$HOME/\.ssh/known_hosts" "\$VPS_USER@\$VPS_HOST" "sudo k3s kubectl rollout status deployment/\$target --namespace learning-platform-dev --timeout=180s"'
  require_match 'done < "\$DEPLOYMENT_DIR/selected-targets"'
  reject_match 'deploy/dev/(compose\.yml|deploy\.sh)'
  reject_match 'docker compose'
  reject_match 'DEV_GHCR_(USERNAME|READ_TOKEN)'
  reject_match 'secrets\.DEV_.*(AWS|AIVEN|RUNTIME)'
  reject_match 'site\.yml --tags monitoring'
  reject_match 'database-migrate|migration-diagnostics|job-name='
  ruby "${ROOT_DIR}/deploy/dev/tests/test-deploy-dev-workflow-policy.rb"
  ruby "${ROOT_DIR}/deploy/dev/tests/test-deploy-dev-workflow-execution.rb"
  bash "${ROOT_DIR}/deploy/dev/tests/test-observability-health.sh"
  printf '%s\n' 'deploy workflow static tests passed'
}

main "$@"
