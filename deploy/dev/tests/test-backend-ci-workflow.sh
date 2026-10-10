#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT_DIR
readonly WORKFLOW="${ROOT_DIR}/.github/workflows/backend-ci.yml"

install_line="$(grep -n '^      - name: Install ffmpeg for local media fixture$' "${WORKFLOW}" | cut -d: -f1)"
e2e_line="$(grep -n '^      - name: Run real MinIO S3-compatible round trip$' "${WORKFLOW}" | cut -d: -f1)"

if [[ -z "${install_line}" || -z "${e2e_line}" || "${install_line}" -ge "${e2e_line}" ]]; then
  printf '%s\n' 'backend CI must install the media fixture tool before the MinIO E2E' >&2
  exit 1
fi

sed -n "${install_line},$((e2e_line - 1))p" "${WORKFLOW}" | grep -q 'sudo apt-get install --yes ffmpeg'
printf '%s\n' 'backend CI fixture dependency contract passed'
