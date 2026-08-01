#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT_DIR
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/render-observability-version.XXXXXX")"
trap 'rm -rf -- "${work_dir}"' EXIT
mkdir -p "${work_dir}/bin"

cat > "${work_dir}/bin/helm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${FAKE_HELM_VERSION:?}"
EOF
chmod 700 "${work_dir}/bin/helm"

accepted=(v3.21.3 v3.21.3+g1ad6e68 v3.21.3+build.42)
rejected=(v3.21.30 v3.21.3-rc.1 v3.21.4 prefix-v3.21.3 v3.21.3+ 'v3.21.3+bad value')

for version in "${accepted[@]}"; do
  FAKE_HELM_VERSION="${version}" PATH="${work_dir}/bin:${PATH}" bash "${ROOT_DIR}/infra/scripts/render-observability.sh" --check-helm-version
done
for version in "${rejected[@]}"; do
  if FAKE_HELM_VERSION="${version}" PATH="${work_dir}/bin:${PATH}" bash "${ROOT_DIR}/infra/scripts/render-observability.sh" --check-helm-version >/dev/null 2>&1; then
    printf 'unexpectedly accepted Helm version: %s\n' "${version}" >&2
    exit 1
  fi
done
printf '%s\n' 'PASS Helm v3.21.3 version acceptance matrix'
