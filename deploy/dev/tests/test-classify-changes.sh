#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT_DIR
readonly CLASSIFIER="${ROOT_DIR}/deploy/dev/classify-changes.sh"

fail() {
  printf 'test failed: %s\n' "$*" >&2
  exit 1
}

assert_output() {
  local target="$1"
  local before_sha="$2"
  local after_sha="$3"
  local expected="$4"
  local actual
  actual="$("${CLASSIFIER}" "${target}" "${before_sha}" "${after_sha}" | grep -v '^observability=')"
  [[ "${actual}" == "${expected}" ]] || fail "unexpected ${target} output: ${actual}"
}

assert_observability_output() {
  local target="$1"
  local before_sha="$2"
  local after_sha="$3"
  local expected="$4"
  local actual

  actual="$("${CLASSIFIER}" "${target}" "${before_sha}" "${after_sha}")"
  grep -Fxq "observability=${expected}" <<<"${actual}" || fail "unexpected observability output for ${target}: ${actual}"
}

commit_file() {
  local path="$1"
  mkdir -p "$(dirname "${path}")"
  printf '%s\n' "${path}" > "${path}"
  git add "${path}"
  git -c user.name=test -c user.email=test@example.com commit -qm "change ${path}"
  git rev-parse HEAD
}

main() {
  local repository
  repository="$(mktemp -d)"
  trap 'rm -rf -- "${repository:-}"' EXIT
  git -C "${repository}" init -q
  git -C "${repository}" commit --allow-empty -qm initial --author='Test <test@example.com>'
  local before_sha after_sha expected
  before_sha="$(git -C "${repository}" rev-parse HEAD)"
  after_sha="$(cd "${repository}" && commit_file web/page.tsx)"
  expected=$'web=true\napi=false\nworker=false\nbackend=false\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/worker/job.ts)"
  expected=$'web=false\napi=false\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/modules/health/health.controller.ts)"
  expected=$'web=false\napi=true\nworker=false\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/database/migrate.ts)"
  expected=$'web=false\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/modules/users/users.service.ts)"
  expected=$'web=false\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/k8s/migration-job.yaml.j2)"
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/applications/tasks/main.yml)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file .github/workflows/deploy-dev.yml)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file deploy/dev/classify-changes.sh)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/k3s/tasks/main.yml)"
  expected=$'web=false\napi=false\nworker=false\nbackend=false\ndeploy_any=false'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/external_secrets/tasks/main.yml)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/monitoring/tasks/main.yml)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file deploy/dev/compose.yml)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file docs/deployment.md)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file .github/ISSUE_TEMPLATE/service.yml)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  expected=$'web=true\napi=false\nworker=false\nbackend=false\ndeploy_any=true'
  (cd "${repository}" && assert_output web "${before_sha}" "${after_sha}" "${expected}")
  expected=$'web=false\napi=true\nworker=false\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output api "${before_sha}" "${after_sha}" "${expected}")
  expected=$'web=false\napi=false\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output worker "${before_sha}" "${after_sha}" "${expected}")
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output all "${before_sha}" "${after_sha}" "${expected}")
  expected=$'web=false\napi=false\nworker=false\nbackend=false\ndeploy_any=false'
  (cd "${repository}" && assert_output observability "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output observability "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_output observability-recovery "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output observability-recovery "${before_sha}" "${after_sha}" true)
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "0000000000000000000000000000000000000000" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "0000000000000000000000000000000000000000" "${after_sha}" false)
  printf '%s\n' 'change classification tests passed'
}

main "$@"
