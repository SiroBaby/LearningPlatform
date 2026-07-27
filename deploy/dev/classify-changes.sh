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
            app/src/worker/*|app/src/worker.ts)
              worker=true
              ;;
            app/src/main.ts|app/src/app.module.ts|app/src/modules/health/*)
              api=true
              ;;
            app/*)
              api=true
              worker=true
              ;;
            # Application delivery automation and application manifests affect
            # every workload. Baseline K3s/ESO/monitoring changes deliberately
            # remain operator-run and never trigger this workflow.
            .github/workflows/deploy-dev.yml|deploy/dev/classify-changes.sh|infra/k8s/*|infra/ansible/roles/applications/*)
              web=true
              api=true
              worker=true
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
    *)
      fail "target must be auto, web, api, worker, or all"
      ;;
  esac

  local backend=false
  local deploy_any=false
  if [[ "${api}" == true || "${worker}" == true ]]; then
    backend=true
  fi
  if [[ "${web}" == true || "${backend}" == true ]]; then
    deploy_any=true
  fi

  printf 'web=%s\n' "${web}"
  printf 'api=%s\n' "${api}"
  printf 'worker=%s\n' "${worker}"
  printf 'backend=%s\n' "${backend}"
  printf 'deploy_any=%s\n' "${deploy_any}"
}

main() {
  [[ "$#" -eq 3 ]] || fail "usage: classify-changes.sh <auto|web|api|worker|all> <before-sha> <after-sha>"
  classify_changes "$1" "$2" "$3"
}

main "$@"
