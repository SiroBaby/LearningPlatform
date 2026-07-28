#!/usr/bin/env bash
set -Eeuo pipefail

: "${CANDIDATE_DIR:?CANDIDATE_DIR is required}"
: "${EVENT_NAME:?EVENT_NAME is required}"

readonly PACKAGES=(learningplatform-api learningplatform-web)

if [[ "${EVENT_NAME}" == workflow_dispatch && "${CONFIRMATION:-}" != DELETE ]]; then
  printf '%s\n' 'manual run is dry-run; type DELETE in confirmation to delete'
  cat "${CANDIDATE_DIR}"/*-delete-ids
  exit 0
fi

: "${GITHUB_TOKEN:?GITHUB_TOKEN is required for deletion}"

for package in "${PACKAGES[@]}"; do
  endpoint="https://api.github.com/user/packages/container/${package}/versions"
  while IFS= read -r version_id; do
    [[ "${version_id}" =~ ^[1-9][0-9]*$ ]] || {
      printf '%s\n' 'selector emitted invalid version ID' >&2
      exit 1
    }
    curl --fail-with-body --silent --show-error --retry 3 \
      --retry-all-errors \
      -X DELETE \
      -H 'Accept: application/vnd.github+json' \
      -H 'X-GitHub-Api-Version: 2022-11-28' \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      "${endpoint}/${version_id}"
  done < "${CANDIDATE_DIR}/${package}-delete-ids"
done
