#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT_DIR
readonly AUDIT_SCRIPT="${ROOT_DIR}/deploy/dev/audit-high.js"
TEMP_DIR="$(mktemp -d)"
readonly TEMP_DIR
trap 'rm -rf -- "${TEMP_DIR}"' EXIT

cat > "${TEMP_DIR}/tree.json" <<'JSON'
{"name":"fixture","dependencies":{"brace-expansion":{"version":"1.1.18"},"nested":{"version":"1.0.0","dependencies":{"brace-expansion":{"version":"2.1.4"},"deeply-nested":{"version":"1.0.0","dependencies":{"brace-expansion":{"version":"5.0.9"}}}}}}}
JSON

cat > "${TEMP_DIR}/patched.json" <<'JSON'
{"vulnerabilities":{"brace-expansion":{"name":"brace-expansion","via":[{"url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg"},{"url":"https://github.com/advisories/GHSA-rgw5-rvv9-x895"}]},"minimatch":{"name":"minimatch","via":["brace-expansion"]}}}
JSON

node "${AUDIT_SCRIPT}" "${TEMP_DIR}/patched.json" "${TEMP_DIR}/tree.json"

cat > "${TEMP_DIR}/old-tree.json" <<'JSON'
{"name":"fixture","dependencies":{"brace-expansion":{"version":"1.1.16"},"nested":{"version":"1.0.0","dependencies":{"brace-expansion":{"version":"2.1.2"},"deeply-nested":{"version":"1.0.0","dependencies":{"brace-expansion":{"version":"5.0.8"}}}}}}}
JSON

if node "${AUDIT_SCRIPT}" "${TEMP_DIR}/patched.json" "${TEMP_DIR}/old-tree.json"; then
  printf '%s\n' 'audit test failed: old brace-expansion versions were accepted for the new advisory' >&2
  exit 1
fi

cat > "${TEMP_DIR}/new-advisory.json" <<'JSON'
{"vulnerabilities":{"brace-expansion":{"name":"brace-expansion","via":[{"url":"https://github.com/advisories/GHSA-rgw5-rvv9-x895"}]}}}
JSON

if node "${AUDIT_SCRIPT}" "${TEMP_DIR}/new-advisory.json" "${TEMP_DIR}/old-tree.json"; then
  printf '%s\n' 'audit test failed: old brace-expansion versions were accepted for the new advisory alone' >&2
  exit 1
fi

cat > "${TEMP_DIR}/unexpected-brace-advisory.json" <<'JSON'
{"vulnerabilities":{"brace-expansion":{"name":"brace-expansion","via":[{"url":"https://github.com/advisories/example"}]}}}
JSON

if node "${AUDIT_SCRIPT}" "${TEMP_DIR}/unexpected-brace-advisory.json" "${TEMP_DIR}/tree.json"; then
  printf '%s\n' 'audit test failed: an unapproved brace-expansion advisory was accepted' >&2
  exit 1
fi

cat > "${TEMP_DIR}/unresolved.json" <<'JSON'
{"vulnerabilities":{"next":{"name":"next","via":[{"url":"https://github.com/advisories/example"}]}}}
JSON

if node "${AUDIT_SCRIPT}" "${TEMP_DIR}/unresolved.json" "${TEMP_DIR}/tree.json"; then
  printf '%s\n' 'audit test failed: an unrelated advisory was accepted' >&2
  exit 1
fi

printf '%s\n' 'audit wrapper tests passed'
