#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT_DIR
SELECTOR="${ROOT_DIR}/deploy/dev/select-ghcr-versions.py"
FIXTURES="${ROOT_DIR}/deploy/dev/tests/fixtures"

fail() { printf 'selector test failed: %s\n' "$*" >&2; exit 1; }

main() {
  local actual malformed_protected
  actual="$(python3 "$SELECTOR" --versions "$FIXTURES/ghcr-versions.json" --protected-digests "$FIXTURES/ghcr-protected-digests.txt" --as-of 2026-07-28T00:00:00Z)"
  [[ "$actual" == $'18\n11' ]] || fail "expected exact-age ID 18 and old unprotected ID 11; got: ${actual:-<none>}"
  [[ "$actual" != *$'\n13' && "$actual" != 13 ]] || fail 'operator-pinned rollback version was selected'
  if python3 "$SELECTOR" --versions "$FIXTURES/ghcr-versions.json" --protected-digests /dev/null --as-of invalid >/dev/null 2>&1; then
    fail 'malformed timestamps must fail closed'
  fi
  malformed_protected="$(mktemp)"
  trap 'rm -f -- "${malformed_protected:-}"' EXIT
  printf '%s\n' 'sha256:not-a-digest' > "$malformed_protected"
  if python3 "$SELECTOR" --versions "$FIXTURES/ghcr-versions.json" --protected-digests "$malformed_protected" --as-of 2026-07-28T00:00:00Z >/dev/null 2>&1; then
    fail 'malformed protected digests must fail closed'
  fi
  printf '%s\n' 'GHCR selector tests passed'
}

main "$@"
