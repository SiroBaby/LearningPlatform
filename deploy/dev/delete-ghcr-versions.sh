#!/usr/bin/env bash
set -Eeuo pipefail

: "${CANDIDATE_DIR:?CANDIDATE_DIR is required}"
: "${EVENT_NAME:?EVENT_NAME is required}"

readonly PACKAGES=(learningplatform-api learningplatform-web)

case "${EVENT_NAME}" in
  schedule|workflow_dispatch) ;;
  *) printf '%s\n' 'unsupported cleanup event; refusing deletion' >&2; exit 1 ;;
esac

# Snapshot and validate all candidates before the first destructive request.
requests=()
declare -A seen=()
for package in "${PACKAGES[@]}"; do
  candidate_file="${CANDIDATE_DIR}/${package}-delete-ids"
  [[ -f "$candidate_file" && -r "$candidate_file" && ! -L "$candidate_file" ]] || {
    printf '%s\n' 'candidate file is missing or unsafe; refusing deletion' >&2
    exit 1
  }
  while IFS= read -r version_id || [[ -n "$version_id" ]]; do
    [[ "$version_id" =~ ^[1-9][0-9]*$ ]] || {
      printf '%s\n' 'selector emitted invalid version ID' >&2
      exit 1
    }
    request="${package}/${version_id}"
    [[ -z "${seen[$request]:-}" ]] || {
      printf '%s\n' 'selector emitted duplicate version ID' >&2
      exit 1
    }
    seen[$request]=true
    requests+=("$request")
  done < "$candidate_file"
done

if [[ "${EVENT_NAME}" == workflow_dispatch && "${CONFIRMATION:-}" != DELETE ]]; then
  printf '%s\n' 'manual run is dry-run; type DELETE in confirmation to delete'
  for request in "${requests[@]}"; do
    printf '%s\n' "$request"
  done
  exit 0
fi

if [[ "${#requests[@]}" -eq 0 ]]; then
  printf '%s\n' 'no eligible GHCR versions; nothing to delete'
  exit 0
fi

: "${GITHUB_TOKEN:?GITHUB_TOKEN is required for deletion}"
: "${OWNER:?OWNER is required for deletion}"
[[ "$OWNER" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]] || {
  printf '%s\n' 'invalid GitHub package owner; refusing deletion' >&2
  exit 1
}

for request in "${requests[@]}"; do
  package="${request%/*}"
  version_id="${request#*/}"
  endpoint="https://api.github.com/users/${OWNER}/packages/container/${package}/versions"
  # curl's default retry list excludes permanent authentication/permission errors.
  curl --fail --silent --show-error --retry 3 --retry-max-time 60 \
    --connect-timeout 10 --max-time 20 \
    -X DELETE \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    "${endpoint}/${version_id}"
done
