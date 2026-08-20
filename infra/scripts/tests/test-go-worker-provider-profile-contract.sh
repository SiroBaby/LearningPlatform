#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../validate.sh"

fixture="$(mktemp)"
trap 'rm -f "${fixture}"' EXIT HUP INT TERM

printf '%s\n' \
  '        - name: unrelated' \
  '            - name: AI_LLM_PROVIDER' \
  '              value: openai-compatible' \
  '            - name: OPENAI_CAPABILITY_VERSION' \
  '              value: chat-completions-json-v1' \
  '            - name: OPENAI_STRUCTURED_OUTPUT_MODE' \
  '              value: json-object' \
  '            - name: OPENAI_TRANSPORT' \
  '              value: chat-completions' \
  '            - name: OPENAI_REQUEST_TIMEOUT_MS' \
  '              value: "60000"' \
  '        - name: go-worker' >"${fixture}"

if has_go_worker_provider_profile "${fixture}"; then
  printf 'go-worker profile contract accepted literals outside the go-worker block\n' >&2
  exit 1
fi

printf '%s\n' \
  '        - name: go-worker' \
  '            - name: AI_LLM_PROVIDER' \
  '              value: openai-compatible' \
  '            - name: OPENAI_CAPABILITY_VERSION' \
  '              value: json-object' \
  '            - name: OPENAI_STRUCTURED_OUTPUT_MODE' \
  '              value: chat-completions-json-v1' \
  '            - name: OPENAI_TRANSPORT' \
  '              value: chat-completions' \
  '            - name: OPENAI_REQUEST_TIMEOUT_MS' \
  '              value: "60000"' >"${fixture}"

if has_go_worker_provider_profile "${fixture}"; then
  printf 'go-worker profile contract accepted values paired with the wrong environment variables\n' >&2
  exit 1
fi

printf '%s\n' \
  '        - name: go-worker' \
  '            - name: AI_LLM_PROVIDER' \
  '              value: openai-compatible' \
  '            - name: OPENAI_CAPABILITY_VERSION' \
  '              value: chat-completions-json-v1' \
  '            - name: OPENAI_STRUCTURED_OUTPUT_MODE' \
  '              value: json-object' \
  '            - name: OPENAI_TRANSPORT' \
  '              value: chat-completions' \
  '            - name: OPENAI_REQUEST_TIMEOUT_MS' \
  '              value: "60000"' \
  '            - name: AI_WORKER_MIGRATIONS_DIR' \
  '              value: /not-app/migrations' >"${fixture}"

has_go_worker_provider_profile "${fixture}"

if has_go_worker_migrations_directory "${fixture}"; then
  printf 'go-worker migrations contract accepted an incorrect migrations directory\n' >&2
  exit 1
fi

printf '%s\n' \
  '        - name: go-worker' \
  '            - name: AI_WORKER_MIGRATIONS_DIR' \
  '              value: /not-app/migrations' \
  '            - name: UNRELATED_PATH' \
  '              value: /app/migrations' >"${fixture}"

if has_go_worker_migrations_directory "${fixture}"; then
  printf 'go-worker migrations contract accepted a value belonging to another environment variable\n' >&2
  exit 1
fi

printf '%s\n' \
  '        - name: go-worker' \
  '            - name: AI_LLM_PROVIDER' \
  '              value: openai-compatible' \
  '            - name: OPENAI_CAPABILITY_VERSION' \
  '              value: chat-completions-json-v1' \
  '            - name: OPENAI_STRUCTURED_OUTPUT_MODE' \
  '              value: json-object' \
  '            - name: OPENAI_TRANSPORT' \
  '              value: chat-completions' \
  '            - name: OPENAI_REQUEST_TIMEOUT_MS' \
  '              value: "60000"' \
  '            - name: AI_WORKER_MIGRATIONS_DIR' \
  '              value: /app/migrations' >"${fixture}"

has_go_worker_migrations_directory "${fixture}"
