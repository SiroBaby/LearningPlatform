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

if node "${AUDIT_SCRIPT}" "${TEMP_DIR}/patched.json" "${TEMP_DIR}/tree.json"; then
  printf '%s\n' 'audit test failed: the retired brace-expansion allowlist was still applied' >&2
  exit 1
fi

cat > "${TEMP_DIR}/clean.json" <<'JSON'
{"vulnerabilities":{}}
JSON
node "${AUDIT_SCRIPT}" "${TEMP_DIR}/clean.json" "${TEMP_DIR}/tree.json"

cat > "${TEMP_DIR}/unresolved.json" <<'JSON'
{"vulnerabilities":{"next":{"name":"next","via":[{"url":"https://github.com/advisories/example"}]}}}
JSON

if node "${AUDIT_SCRIPT}" "${TEMP_DIR}/unresolved.json" "${TEMP_DIR}/tree.json"; then
  printf '%s\n' 'audit test failed: an unrelated advisory was accepted' >&2
  exit 1
fi

readonly BRACES_URL='https://github.com/advisories/GHSA-vfj7-8cjw-p6xm'
readonly BRACES_LINT_TREE='{"name":"fixture","dependencies":{"eslint-config-next":{"version":"16.4.0","dependencies":{"@next/eslint-plugin-next":{"version":"16.4.0","dependencies":{"fast-glob":{"version":"3.3.1","dependencies":{"micromatch":{"version":"4.0.8","dependencies":{"braces":{"version":"3.0.3"}}}}}}}}}}}'

write_braces_audit() {
  local output_path="$1"
  local url="$2"
  local range="$3"
  printf '{"vulnerabilities":{"braces":{"name":"braces","via":[{"url":"%s","range":"%s"}]},"micromatch":{"name":"micromatch","via":["braces"]},"fast-glob":{"name":"fast-glob","via":["micromatch"]},"@next/eslint-plugin-next":{"name":"@next/eslint-plugin-next","via":["fast-glob"]},"eslint-config-next":{"name":"eslint-config-next","via":["@next/eslint-plugin-next"]}}}\n' \
    "${url}" "${range}" > "${output_path}"
}

expect_braces_rejected() {
  local audit_path="$1"
  local tree_path="$2"
  local reason="$3"
  local production_tree_path="${4:-${TEMP_DIR}/empty-production-tree.json}"
  if node "${AUDIT_SCRIPT}" "${audit_path}" "${tree_path}" "${production_tree_path}"; then
    printf 'audit test failed: %s\n' "${reason}" >&2
    exit 1
  fi
}

printf '%s\n' "${BRACES_LINT_TREE}" > "${TEMP_DIR}/braces-tree.json"
printf '%s\n' '{"version":"0.1.0","name":"fixture"}' > "${TEMP_DIR}/empty-production-tree.json"
write_braces_audit "${TEMP_DIR}/braces.json" "${BRACES_URL}" '<=3.0.3'
node "${AUDIT_SCRIPT}" "${TEMP_DIR}/braces.json" "${TEMP_DIR}/braces-tree.json" "${TEMP_DIR}/empty-production-tree.json"

if node "${AUDIT_SCRIPT}" "${TEMP_DIR}/braces.json" "${TEMP_DIR}/braces-tree.json"; then
  printf '%s\n' 'audit test failed: braces exception was accepted without a production tree' >&2
  exit 1
fi

# Real `npm ls --all` output: the runtime path stops at a deduped micromatch without its subtree.
cat > "${TEMP_DIR}/braces-deduped-runtime-tree.json" <<'JSON'
{"name":"fixture","dependencies":{"eslint-config-next":{"version":"16.4.0","dependencies":{"@next/eslint-plugin-next":{"version":"16.4.0","dependencies":{"fast-glob":{"version":"3.3.1","dependencies":{"micromatch":{"version":"4.0.8","dependencies":{"braces":{"version":"3.0.3"}}}}}}}}},"zz-rt1":{"version":"1.0.0","dependencies":{"zz-rt2":{"version":"1.0.0","dependencies":{"zz-rt3":{"version":"1.0.0","dependencies":{"zz-rt4":{"version":"1.0.0","dependencies":{"micromatch":{"version":"4.0.8"}}}}}}}}}}}
JSON
cat > "${TEMP_DIR}/braces-production-tree.json" <<'JSON'
{"name":"fixture","dependencies":{"zz-rt1":{"version":"1.0.0","dependencies":{"zz-rt2":{"version":"1.0.0","dependencies":{"zz-rt3":{"version":"1.0.0","dependencies":{"zz-rt4":{"version":"1.0.0","dependencies":{"micromatch":{"version":"4.0.8","dependencies":{"braces":{"version":"3.0.3"}}}}}}}}}}}}}
JSON
expect_braces_rejected "${TEMP_DIR}/braces.json" "${TEMP_DIR}/braces-deduped-runtime-tree.json" \
  'braces on a production path hidden by npm ls dedupe was accepted' "${TEMP_DIR}/braces-production-tree.json"

printf '%s\n' '{"name":"fixture","problems":["invalid: micromatch@4.0.8"]}' > "${TEMP_DIR}/broken-production-tree.json"
expect_braces_rejected "${TEMP_DIR}/braces.json" "${TEMP_DIR}/braces-tree.json" \
  'braces exception was accepted with an unreliable production tree' "${TEMP_DIR}/broken-production-tree.json"

printf '%s\n' "${BRACES_LINT_TREE/\"braces\":\{\"version\":\"3.0.3\"\}/\"braces\":{\"version\":\"3.0.2\"}}" > "${TEMP_DIR}/braces-other-version-tree.json"
expect_braces_rejected "${TEMP_DIR}/braces.json" "${TEMP_DIR}/braces-other-version-tree.json" 'an unapproved braces version was accepted'

write_braces_audit "${TEMP_DIR}/braces-other-advisory.json" 'https://github.com/advisories/example' '<=3.0.3'
expect_braces_rejected "${TEMP_DIR}/braces-other-advisory.json" "${TEMP_DIR}/braces-tree.json" 'an unapproved braces advisory was accepted'

write_braces_audit "${TEMP_DIR}/braces-patched-range.json" "${BRACES_URL}" '<3.0.4'
expect_braces_rejected "${TEMP_DIR}/braces-patched-range.json" "${TEMP_DIR}/braces-tree.json" 'braces exception survived a changed advisory range'

cat > "${TEMP_DIR}/braces-runtime-tree.json" <<'JSON'
{"name":"fixture","dependencies":{"eslint-config-next":{"version":"16.4.0","dependencies":{"@next/eslint-plugin-next":{"version":"16.4.0","dependencies":{"fast-glob":{"version":"3.3.1","dependencies":{"micromatch":{"version":"4.0.8","dependencies":{"braces":{"version":"3.0.3"}}}}}}}}},"chokidar":{"version":"3.6.0","dependencies":{"braces":{"version":"3.0.3"}}}}}
JSON
expect_braces_rejected "${TEMP_DIR}/braces.json" "${TEMP_DIR}/braces-runtime-tree.json" 'braces outside the lint-only path was accepted'

expect_braces_rejected "${TEMP_DIR}/braces.json" "${TEMP_DIR}/tree.json" 'braces exception was accepted without an installed braces tree'

printf '%s\n' 'audit wrapper tests passed'
