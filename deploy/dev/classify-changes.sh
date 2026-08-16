#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "change classification failed: $*" >&2
  exit 1
}

is_zero_sha() {
  [[ "$1" =~ ^0+$ ]]
}

list_changed_files() {
  local before_sha="$1"
  local after_sha="$2"

  if is_zero_sha "${before_sha}"; then
    git diff-tree --no-commit-id --name-only -r "${after_sha}"
    return
  fi

  git diff --name-only "${before_sha}" "${after_sha}"
}

classify_changes() {
  local target="$1"
  local before_sha="$2"
  local after_sha="$3"
  local web=false
  local api=false
  local worker=false
  local go_worker=false
  local observability=false
  local changed_file

  case "${target}" in
    auto)
      if is_zero_sha "${before_sha}"; then
        web=true
        api=true
        worker=true
      else
        while IFS= read -r changed_file; do
          case "${changed_file}" in
            web/*.md|web/MODIFIED_FILES.txt|app/*.md|app/MODIFIED_FILES.txt)
              ;;
            web/*)
              web=true
              ;;
            worker/*)
              go_worker=true
              worker=true
              ;;
            app/src/worker/*|app/src/worker.ts)
              worker=true
              ;;
            app/src/main.ts|app/src/app.module.ts|app/src/modules/health/*)
              api=true
              ;;
            app/*)
              api=true
              worker=true
              go_worker=true
              ;;
            # Application delivery automation and application manifests affect
            # every workload. Baseline K3s/ESO/monitoring changes deliberately
            # remain operator-run and never trigger this workflow.
            infra/k8s/*|infra/ansible/roles/cert_manager/*|infra/ansible/roles/applications/*)
              web=true
              api=true
              worker=true
              ;;
            .github/workflows/deploy-dev.yml|deploy/dev/classify-changes.sh|deploy/dev/observability-health.sh|deploy/dev/tests/test-observability-health.sh|infra/observability/*|infra/ansible/playbooks/site.yml|infra/ansible/roles/observability/*|infra/ansible/roles/external_secrets/*|infra/ansible/roles/k3s/*|infra/ansible/vars/dev.yml|infra/scripts/*)
              observability=true
              ;;
          esac
        done < <(list_changed_files "${before_sha}" "${after_sha}")
      fi
      ;;
    web)
      web=true
      ;;
    api)
      api=true
      ;;
    worker)
      worker=true
      ;;
    all)
      web=true
      api=true
      worker=true
      ;;
    observability)
      observability=true
      ;;
    observability-recovery)
      observability=true
      ;;
    observability-health)
      observability=true
      ;;
    *)
      fail "target must be auto, web, api, worker, observability, observability-recovery, observability-health, or all"
      ;;
  esac

  local backend=false
  local deploy_any=false
  if [[ "${api}" == true || "${worker}" == true || "${go_worker}" == true ]]; then
    backend=true
  fi
  if [[ "${web}" == true || "${backend}" == true ]]; then
    deploy_any=true
  fi

  printf 'web=%s\n' "${web}"
  printf 'api=%s\n' "${api}"
  printf 'worker=%s\n' "${worker}"
  printf 'go_worker=%s\n' "${go_worker}"
  printf 'observability=%s\n' "${observability}"
  printf 'backend=%s\n' "${backend}"
  printf 'deploy_any=%s\n' "${deploy_any}"
}

main() {
  [[ "$#" -eq 3 ]] || fail "usage: classify-changes.sh <auto|web|api|worker|observability|observability-recovery|observability-health|all> <before-sha> <after-sha>"
  classify_changes "$1" "$2" "$3"
}

main "$@"
