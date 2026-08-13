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

require_diagnostics_match() {
  grep -Eq -- "$1" <<<"${DIAGNOSTICS_BLOCK}" || fail "missing rollout diagnostics pattern: $1"
}

reject_diagnostics_match() {
  if grep -Eq -- "$1" <<<"${DIAGNOSTICS_BLOCK}"; then
    fail "forbidden rollout diagnostics pattern: $1"
  fi
}

main() {
  DIAGNOSTICS_BLOCK="$(sed -n '/# Begin rollout failure diagnostics/,/# End rollout failure diagnostics/p' "${WORKFLOW}")"
  readonly DIAGNOSTICS_BLOCK

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
  require_match 'if ! ssh -n -o BatchMode=yes -o ConnectTimeout=15 -o ConnectionAttempts=1 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 -o StrictHostKeyChecking=yes'
  require_match 'sudo timeout 190s k3s kubectl rollout status deployment/\$target --namespace learning-platform-dev --timeout=180s'
  require_match '^[[:space:]]+exit 1$'
  require_match 'done < "\$DEPLOYMENT_DIR/selected-targets"'
  require_diagnostics_match 'ssh -n -o BatchMode=yes -o ConnectTimeout=15 -o ConnectionAttempts=1 -o ServerAliveInterval=5 -o ServerAliveCountMax=2'
  require_diagnostics_match 'timeout 20s sudo k3s kubectl'
  require_diagnostics_match 'kubectl_timeout get deployment/'
  require_diagnostics_match 'jsonpath=\{range \.items\[\?\(@\.spec\.nodeName\)\]\}'
  require_diagnostics_match 'kubectl_timeout describe node'
  require_diagnostics_match 'target node diagnostic'
  require_diagnostics_match 'describe node \\\"\\\$node\\\" 2>&1 \\| head -n 200'
  require_diagnostics_match 'No selected target pods have an assigned node\.'
  reject_diagnostics_match 'kubectl describe nodes'
  reject_diagnostics_match 'kubectl (apply|create|delete|edit|exec|patch|replace|scale)'
  reject_diagnostics_match 'kubectl rollout (restart|undo|pause|resume)'
  reject_diagnostics_match 'kubectl (get|describe) secret'
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
