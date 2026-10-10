#!/usr/bin/env bash
# Install the pinned BtbN ffmpeg/ffprobe build that the media-probe image uses.
# The pin is read from worker/Dockerfile so CI and production cannot drift; the
# archive SHA-256 is verified before extraction and the binary version after.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly DOCKERFILE="${MEDIA_TOOLS_DOCKERFILE:-${ROOT_DIR}/worker/Dockerfile}"
readonly INSTALL_DIR="${MEDIA_TOOLS_INSTALL_DIR:-${RUNNER_TEMP:-/tmp}/media-tools/bin}"

fail() {
  printf 'install-media-tools: %s\n' "$*" >&2
  exit 1
}

read_pin() {
  local value
  value="$(sed -n "s/^ARG $1=\\(.*\\)\$/\\1/p" "${DOCKERFILE}")"
  [[ -n "${value}" && "${value}" != *'$'* && "${value}" != *$'\n'* ]] || fail "missing literal ARG $1 in ${DOCKERFILE}"
  printf '%s' "${value}"
}

read_binary_version() {
  "$1" -version 2>/dev/null | awk -v name="$2" 'NR == 1 && $1 == name && $2 == "version" { sub(/^n/, "", $3); print $3 }'
}

main() {
  local version build_version release asset sha256 work_dir archive tool installed_version
  version="$(read_pin FFPROBE_VERSION)"
  build_version="$(read_pin FFPROBE_BUILD_VERSION)"
  release="$(read_pin FFPROBE_RELEASE)"
  asset="$(read_pin FFPROBE_ASSET)"
  sha256="$(read_pin FFPROBE_SHA256)"
  [[ "${asset}" == "ffmpeg-n${version}-"*.tar.xz ]] || fail 'FFPROBE_ASSET must match FFPROBE_VERSION'
  [[ "${sha256}" =~ ^[0-9a-f]{64}$ ]] || fail 'FFPROBE_SHA256 must be a lowercase SHA-256 digest'
  work_dir="$(mktemp -d)"
  # shellcheck disable=SC2064 # Expand now: work_dir is local to main.
  trap "rm -rf -- '${work_dir}'" EXIT
  archive="${MEDIA_TOOLS_ARCHIVE:-${work_dir}/ffmpeg.tar.xz}"
  if [[ -z "${MEDIA_TOOLS_ARCHIVE:-}" ]]; then
    curl --fail --location --silent --show-error --retry 3 --connect-timeout 10 --max-time 180 \
      "https://github.com/BtbN/FFmpeg-Builds/releases/download/${release}/${asset}" --output "${archive}"
  fi
  printf '%s  %s\n' "${sha256}" "${archive}" | sha256sum --check --status || fail "checksum mismatch for ${asset}"
  mkdir -p "${INSTALL_DIR}"
  tar --extract --xz --file "${archive}" --strip-components=2 --directory "${INSTALL_DIR}" \
    "${asset%.tar.xz}/bin/ffmpeg" "${asset%.tar.xz}/bin/ffprobe"
  for tool in ffmpeg ffprobe; do
    installed_version="$(read_binary_version "${INSTALL_DIR}/${tool}" "${tool}")"
    [[ "${installed_version}" == "${build_version}" ]] || fail "${tool} reports '${installed_version}', expected '${build_version}'"
  done
  if [[ -n "${GITHUB_PATH:-}" ]]; then
    printf '%s\n' "${INSTALL_DIR}" >> "${GITHUB_PATH}"
  fi
  printf 'installed ffmpeg/ffprobe %s into %s\n' "${build_version}" "${INSTALL_DIR}"
}

main "$@"
