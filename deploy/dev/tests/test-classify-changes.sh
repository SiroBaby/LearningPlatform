#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT_DIR
readonly CLASSIFIER="${ROOT_DIR}/deploy/dev/classify-changes.sh"
readonly FIXTURE_DIRECTORY_TEMPLATE="${TMPDIR:-/tmp}/learning-platform-classify-changes.XXXXXX"

repository=""

cleanup() {
  local exit_status="$?"

  # Only remove the fixture directory that this test created under the fixed template.
  if [[ "${repository}" == "${TMPDIR:-/tmp}/learning-platform-classify-changes."* ]]; then
    rm -rf -- "${repository}"
  fi

  exit "${exit_status}"
}

if [[ "${TEST_GIT_USE_CONFIG_ONLY:-}" != "true" ]]; then
  TEST_GIT_USE_CONFIG_ONLY=true \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=user.useConfigOnly \
    GIT_CONFIG_VALUE_0=true \
    bash "$0" "$@"
  exit $?
fi

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

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
  actual="$("${CLASSIFIER}" "${target}" "${before_sha}" "${after_sha}" | grep -Ev '^(observability|go_worker)=')"
  [[ "${actual}" == "${expected}" ]] || fail "unexpected ${target} output: ${actual}"
}

assert_go_worker_output() {
  local before_sha="$1"
  local after_sha="$2"
  local actual

  actual="$("${CLASSIFIER}" auto "${before_sha}" "${after_sha}")"
  grep -Fxq 'go_worker=true' <<<"${actual}" || fail "worker/** must enable Go worker CI: ${actual}"
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
  git commit -qm "change ${path}"
  git rev-parse HEAD
}

main() {
  repository="$(mktemp -d "${FIXTURE_DIRECTORY_TEMPLATE}")"
  git -C "${repository}" init -q
  git -C "${repository}" config user.name test
  git -C "${repository}" config user.email test@example.com
  git -C "${repository}" commit --allow-empty -qm initial
  local before_sha after_sha expected
  before_sha="$(git -C "${repository}" rev-parse HEAD)"
  after_sha="$(cd "${repository}" && commit_file web/page.tsx)"
  expected=$'web=true\napi=false\nworker=false\nbackend=false\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
	after_sha="$(cd "${repository}" && commit_file worker/internal/consumer/consumer.go)"
	expected=$'web=false\napi=false\nworker=true\nbackend=true\ndeploy_any=true'
	(cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
	(cd "${repository}" && assert_go_worker_output "${before_sha}" "${after_sha}")

	before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/worker/job.ts)"
  expected=$'web=false\napi=false\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_go_worker_output "${before_sha}" "${after_sha}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/modules/health/health.controller.ts)"
  expected=$'web=false\napi=true\nworker=false\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/database/migrations/20260804-backend-startup.ts)"
  expected=$'web=false\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/modules/users/users.service.ts)"
  expected=$'web=false\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/database/migrate.ts)"
  expected=$'web=false\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/applications/tasks/main.yml)"
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" false)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/k8s/apps.yaml.j2)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" false)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/cert_manager/tasks/main.yml)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" false)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file .github/workflows/deploy-dev.yml)"
  expected=$'web=false\napi=false\nworker=false\nbackend=false\ndeploy_any=false'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file deploy/dev/classify-changes.sh)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file deploy/dev/observability-health.sh)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/main.ts)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" $'web=false\napi=true\nworker=false\nbackend=true\ndeploy_any=true')

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/k3s/tasks/main.yml)"
  expected=$'web=false\napi=false\nworker=false\nbackend=false\ndeploy_any=false'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/observability/kube-prometheus-stack-values.yml)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/external_secrets/tasks/main.yml)"
  expected=$'web=false\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" false)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/monitoring/tasks/main.yml)"
  expected=$'web=false\napi=false\nworker=false\nbackend=false\ndeploy_any=false'
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
  (cd "${repository}" && assert_output observability-health "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output observability-health "${before_sha}" "${after_sha}" true)
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "0000000000000000000000000000000000000000" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "0000000000000000000000000000000000000000" "${after_sha}" false)
  printf '%s\n' 'change classification tests passed'
}

main "$@"
