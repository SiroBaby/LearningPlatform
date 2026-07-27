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
  require_match 'ansible-galaxy.*collection install -r infra/ansible/requirements\.yml'
  require_match 'site\.yml --tags applications'
  require_match 'DEV_K3S_ANSIBLE_VARS_B64'
  require_match 'k3s kubectl rollout status deployment/'
  require_match 'StrictHostKeyChecking=yes'
  require_match 'chmod 600 .*group_vars/k3s_nodes\.yml'
  require_match 'if: always\(\)'
  reject_match 'deploy/dev/(compose\.yml|deploy\.sh)'
  reject_match 'docker compose'
  reject_match 'DEV_GHCR_(USERNAME|READ_TOKEN)'
  reject_match 'secrets\.DEV_.*(AWS|AIVEN|RUNTIME)'
  reject_match '--tags (k3s|external_secrets|monitoring)'
  printf '%s\n' 'deploy workflow static tests passed'
}

main "$@"
