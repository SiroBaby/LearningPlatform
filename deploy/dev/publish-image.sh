#!/usr/bin/env bash
set -Eeuo pipefail

: "${BUILD_CONTEXT:?}" "${DOCKERFILE:?}" "${IMAGE:?}" "${GITHUB_OUTPUT:?}"
[[ "$IMAGE" =~ ^ghcr\.io/sirobaby/learningplatform-(api|web|ai-worker|media-probe):sha-[a-f0-9]{40}$ ]] || {
  printf '%s\n' 'invalid immutable image tag' >&2
  exit 1
}

# Multi-target Dockerfiles must publish the same stage that was cached.
target_args=()
[[ -z "${BUILD_TARGET:-}" ]] || target_args=(--target "$BUILD_TARGET")

publish_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/ghcr-publish.XXXXXX")"
trap 'rm -rf -- "$publish_dir"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

for attempt in 1 2 3; do
  # Reuse the same builder and build inputs: publication solves cached layers.
  if timeout 600s docker buildx build "$BUILD_CONTEXT" --file "$DOCKERFILE" ${target_args[@]+"${target_args[@]}"} \
    --platform linux/amd64 --tag "$IMAGE" --provenance=mode=min,inline-only=true \
    --metadata-file "$publish_dir/metadata.json" --push > "$publish_dir/push.log" 2>&1; then
    digest="$(python3 - "$publish_dir/metadata.json" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding='utf-8') as metadata:
    digest = json.load(metadata).get('containerimage.digest', '')
if not isinstance(digest, str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
    sys.exit('registry publication returned no valid manifest digest')
print(digest)
PY
    )"
    printf 'digest=%s\n' "$digest" >> "$GITHUB_OUTPUT"
    printf 'GHCR publication succeeded on attempt %s\n' "$attempt"
    exit 0
  else
    status=$?
  fi

  category="$(python3 - "$publish_dir/push.log" <<'PY'
import re
import sys

with open(sys.argv[1], encoding='utf-8', errors='replace') as log:
    text = log.read()
# Authentication, policy and TLS errors always win over transient-looking text.
if re.search(r'\b(unauthorized|denied|forbidden)\b|\b(401|403)\b|x509|certificate', text, re.I):
    print('permanent')
else:
    push_errors = [line for line in text.splitlines()
                   if re.search(r'failed to push ghcr\.io/sirobaby/', line, re.I)]
    transient = r'\b(429|500|502|503|504)\b|connection reset by peer|i/o timeout|TLS handshake timeout|unexpected EOF'
    print('transient' if any(re.search(transient, line, re.I) for line in push_errors) else 'unclassified')
PY
  )"
  printf 'GHCR publication failed: attempt=%s rc=%s category=%s\n' "$attempt" "$status" "$category" >&2
  # Keep raw tool output private; never turn unknown/build failures into retries.
  [[ "$category" == transient && "$attempt" -lt 3 && "$status" -ne 124 ]] || exit "$status"
  sleep "$((attempt * 10))"
done
