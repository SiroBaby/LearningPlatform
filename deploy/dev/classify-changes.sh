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
  local infra_quality=false
  local changed_file

  case "${target}" in
    auto)
      if is_zero_sha "${before_sha}"; then
        web=true
        api=true
        worker=true
        go_worker=true
        infra_quality=true
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
              if [[ "${changed_file}" == worker/Dockerfile ]]; then
                infra_quality=true
              fi
              ;;
            app/src/worker/*|app/src/worker.ts)
              worker=true
              go_worker=true
              ;;
            app/src/main.ts|app/src/app.module.ts|app/src/modules/health/*)
              # The web BFF consumes the API authentication contract. Reconcile
              # it whenever the shared backend changes so a partial rollout
              # cannot leave the BFF on a legacy runtime contract.
              web=true
              api=true
              ;;
            app/*)
              web=true
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
              go_worker=true
              infra_quality=true
              ;;
            infra/ansible/vars/dev.yml)
              # The dev vars also render web runtime env (MEDIA_UPLOADS_ENABLED
              # follows api_media_enabled), so a flag change must reach web too.
              web=true
              api=true
              worker=true
              go_worker=true
              infra_quality=true
              ;;
            infra/ansible/roles/external_secrets/*)
              api=true
              worker=true
              go_worker=true
              infra_quality=true
              ;;
            deploy/dev/classify-changes.sh)
              # A classifier change must reconcile every application so a
              # corrected target decision also repairs stale workloads.
              web=true
              api=true
              worker=true
              go_worker=true
              infra_quality=true
              ;;
            # Keep before deploy/dev/tests/* so the observability health test is not shadowed.
            deploy/dev/observability-health.sh|deploy/dev/tests/test-observability-health.sh|infra/observability/*|infra/ansible/playbooks/site.yml|infra/ansible/roles/observability/*|infra/ansible/roles/k3s/*)
              observability=true
              infra_quality=true
              ;;
            .github/workflows/deploy-dev.yml|infra/scripts/*|deploy/dev/tests/*)
              infra_quality=true
              ;;
          esac
        done < <(list_changed_files "${before_sha}" "${after_sha}")
      fi
      ;;
    web)
      web=true
      infra_quality=true
      ;;
    api)
      api=true
      infra_quality=true
      ;;
    worker)
      worker=true
      go_worker=true
      infra_quality=true
      ;;
    all)
      web=true
      api=true
      worker=true
      go_worker=true
      infra_quality=true
      ;;
    observability)
      observability=true
      infra_quality=true
      ;;
    observability-recovery)
      observability=true
      infra_quality=true
      ;;
    observability-health)
      observability=true
      infra_quality=true
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
  printf 'infra_quality=%s\n' "${infra_quality}"
  printf 'backend=%s\n' "${backend}"
  printf 'deploy_any=%s\n' "${deploy_any}"
}

main() {
  [[ "$#" -eq 3 ]] || fail "usage: classify-changes.sh <auto|web|api|worker|observability|observability-recovery|observability-health|all> <before-sha> <after-sha>"
  classify_changes "$1" "$2" "$3"
}

main "$@"
