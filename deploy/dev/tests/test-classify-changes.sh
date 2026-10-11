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
  actual="$("${CLASSIFIER}" "${target}" "${before_sha}" "${after_sha}" | grep -Ev '^(observability|go_worker|infra_quality)=')"
  [[ "${actual}" == "${expected}" ]] || fail "unexpected ${target} output: ${actual}"
}

assert_go_worker_output() {
  local before_sha="$1"
  local after_sha="$2"
  local actual

  actual="$("${CLASSIFIER}" auto "${before_sha}" "${after_sha}")"
  grep -Fxq 'go_worker=true' <<<"${actual}" || fail "worker/** must enable Go worker CI: ${actual}"
}

assert_infra_go_worker_output() {
  local before_sha="$1"
  local after_sha="$2"
  local actual

  actual="$("${CLASSIFIER}" auto "${before_sha}" "${after_sha}")"
  grep -Fxq 'worker=true' <<<"${actual}" || fail "infrastructure application changes must enable worker CI: ${actual}"
  grep -Fxq 'go_worker=true' <<<"${actual}" || fail "infrastructure application changes must enable Go worker CI: ${actual}"
}

assert_manual_worker_go_worker_output() {
  local before_sha="$1"
  local after_sha="$2"
  local actual

  actual="$("${CLASSIFIER}" worker "${before_sha}" "${after_sha}")"
  grep -Fxq 'go_worker=true' <<<"${actual}" || fail "manual worker rollout must enable Go worker CI: ${actual}"
}

assert_manual_all_go_worker_output() {
  local before_sha="$1"
  local after_sha="$2"
  local actual

  actual="$(${CLASSIFIER} all "${before_sha}" "${after_sha}")"
  grep -Fxq 'go_worker=true' <<<"${actual}" || fail "manual all rollout must enable Go worker CI: ${actual}"
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

assert_infra_quality_output() {
  local target="$1"
  local before_sha="$2"
  local after_sha="$3"
  local expected="$4"
  local actual

  actual="$("${CLASSIFIER}" "${target}" "${before_sha}" "${after_sha}")"
  grep -Fxq "infra_quality=${expected}" <<<"${actual}" || fail "unexpected infrastructure quality output for ${target}: ${actual}"
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
  local before_sha after_sha expected actual
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
  after_sha="$(cd "${repository}" && commit_file worker/Dockerfile)"
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

	before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/worker/job.ts)"
  expected=$'web=false\napi=false\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_go_worker_output "${before_sha}" "${after_sha}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/modules/health/health.controller.ts)"
  expected=$'web=true\napi=true\nworker=false\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/database/migrations/20260804-backend-startup.ts)"
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/modules/users/users.service.ts)"
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  # document-purge-worker runs the backend image under the worker target, so
  # every purge runtime source must select worker for its rollout (#159).
  local purge_source
  for purge_source in \
    app/src/modules/content/document-purge.service.ts \
    app/src/storage/object-storage-document-purger.ts \
    app/src/config/document-purge.config.ts \
    app/src/worker/document-purge-runner.service.ts; do
    before_sha="${after_sha}"
    after_sha="$(cd "${repository}" && commit_file "${purge_source}")"
    actual="$(cd "${repository}" && "${CLASSIFIER}" auto "${before_sha}" "${after_sha}")"
    grep -Fxq 'worker=true' <<<"${actual}" || fail "${purge_source} must select the worker target that rolls out document-purge-worker: ${actual}"
  done

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/database/migrate.ts)"
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/applications/tasks/main.yml)"
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_infra_go_worker_output "${before_sha}" "${after_sha}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" false)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/k8s/apps.yaml.j2)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_infra_go_worker_output "${before_sha}" "${after_sha}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" false)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/cert_manager/tasks/main.yml)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_infra_go_worker_output "${before_sha}" "${after_sha}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" false)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file .github/workflows/deploy-dev.yml)"
  expected=$'web=false\napi=false\nworker=false\nbackend=false\ndeploy_any=false'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" false)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/scripts/validate.sh)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" $'web=false\napi=false\nworker=false\nbackend=false\ndeploy_any=false')
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" false)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file deploy/dev/classify-changes.sh)"
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file deploy/dev/observability-health.sh)"
  expected=$'web=false\napi=false\nworker=false\nbackend=false\ndeploy_any=false'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

  # The observability health test must not be shadowed by the generic deploy test pattern.
  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file deploy/dev/tests/test-observability-health.sh)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file deploy/dev/tests/test-deploy-state.sh)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" false)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file app/src/main.ts)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" $'web=true\napi=true\nworker=false\nbackend=true\ndeploy_any=true')

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/k3s/tasks/main.yml)"
  expected=$'web=false\napi=false\nworker=false\nbackend=false\ndeploy_any=false'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/observability/kube-prometheus-stack-values.yml)"
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/roles/external_secrets/tasks/main.yml)"
  expected=$'web=false\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_infra_go_worker_output "${before_sha}" "${after_sha}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" false)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

  before_sha="${after_sha}"
  after_sha="$(cd "${repository}" && commit_file infra/ansible/vars/dev.yml)"
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_infra_go_worker_output "${before_sha}" "${after_sha}")
  (cd "${repository}" && assert_observability_output auto "${before_sha}" "${after_sha}" false)
  (cd "${repository}" && assert_infra_quality_output auto "${before_sha}" "${after_sha}" true)

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
  (cd "${repository}" && assert_infra_quality_output web "${before_sha}" "${after_sha}" true)
  expected=$'web=false\napi=true\nworker=false\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output api "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_infra_quality_output api "${before_sha}" "${after_sha}" true)
  expected=$'web=false\napi=false\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output worker "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_infra_quality_output worker "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_manual_worker_go_worker_output "${before_sha}" "${after_sha}")
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output all "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_infra_quality_output all "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_manual_all_go_worker_output "${before_sha}" "${after_sha}")
  expected=$'web=false\napi=false\nworker=false\nbackend=false\ndeploy_any=false'
  (cd "${repository}" && assert_output observability "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output observability "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_infra_quality_output observability "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_output observability-recovery "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output observability-recovery "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_infra_quality_output observability-recovery "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_output observability-health "${before_sha}" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_observability_output observability-health "${before_sha}" "${after_sha}" true)
  (cd "${repository}" && assert_infra_quality_output observability-health "${before_sha}" "${after_sha}" true)
  expected=$'web=true\napi=true\nworker=true\nbackend=true\ndeploy_any=true'
  (cd "${repository}" && assert_output auto "0000000000000000000000000000000000000000" "${after_sha}" "${expected}")
  (cd "${repository}" && assert_go_worker_output "0000000000000000000000000000000000000000" "${after_sha}")
  (cd "${repository}" && assert_observability_output auto "0000000000000000000000000000000000000000" "${after_sha}" false)
  printf '%s\n' 'change classification tests passed'
}

main "$@"
