#!/usr/bin/env bash

set -Eeuo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
run_id="local-document-e2e-$$"
minio_image="bitnamilegacy/minio@sha256:8343eea75f4f7ef6394e3e1f1a5447706bac719bf8b0731cbbf4c473f3050712"
tmp_root=${TMPDIR:-/tmp}
PHASE=initialization
temp_dir=""
network_name="${run_id}-network"
postgres_container="${run_id}-postgres"
minio_container="${run_id}-minio"
media_probe_container="${run_id}-media-probe"
postgres_volume="${run_id}-postgres-data"
minio_volume="${run_id}-minio-data"
postgres_port=""
minio_port=""
api_port=""
auth_owner_id=""
auth_access_token=""
api_log=""
relay_log=""
relay_health_port=""
go_health_port=""
media_probe_health_port=""
go_log=""
media_probe_log=""
api_pid=""
relay_pid=""
go_pid=""
media_probe_pid=""
media_probe_container_created=false
network_created=false
postgres_volume_created=false
minio_volume_created=false
postgres_container_created=false
minio_container_created=false
result_emitted=false
document_flow_result=""
document_id=""
requested_provider_mode=${LOCAL_DOCUMENT_E2E_PROVIDER_MODE:-}
provider_mode=""

emit_phase() {
  PHASE=$1
  printf 'PHASE %s\n' "$PHASE"
}

emit_result() {
  printf 'RESULT %s\n' "$1"
  result_emitted=true
}

report_failure() {
  local exit_code=$?
  if [[ "$result_emitted" == false ]]; then
    emit_result FAIL
    printf 'CATEGORY %s\n' "$PHASE"
  fi
  return "$exit_code"
}

cleanup() {
  local exit_code=$?
  local failure_phase=$PHASE
  local pid
  trap - EXIT HUP INT TERM
  trap - ERR
  set +e
  PHASE=cleanup-pids
  for pid in "$api_pid" "$relay_pid" "$go_pid" "$media_probe_pid"; do
    if [[ -n "$pid" ]]; then
      kill "$pid" >/dev/null 2>&1
      wait "$pid" >/dev/null 2>&1
    fi
  done
  PHASE=cleanup-postgres-container
  if [[ "$postgres_container_created" == true ]]; then
    docker rm -f "$postgres_container" >/dev/null 2>&1
  fi
  PHASE=cleanup-minio-container
  if [[ "$minio_container_created" == true ]]; then
    docker rm -f "$minio_container" >/dev/null 2>&1
  fi
  PHASE=cleanup-media-probe-container
  if [[ "$media_probe_container_created" == true ]]; then
    docker rm -f "$media_probe_container" >/dev/null 2>&1
  fi
  PHASE=cleanup-postgres-volume
  if [[ "$postgres_volume_created" == true ]]; then
    docker volume rm "$postgres_volume" >/dev/null 2>&1
  fi
  PHASE=cleanup-minio-volume
  if [[ "$minio_volume_created" == true ]]; then
    docker volume rm "$minio_volume" >/dev/null 2>&1
  fi
  PHASE=cleanup-network
  if [[ "$network_created" == true ]]; then
    docker network rm "$network_name" >/dev/null 2>&1
  fi
  PHASE=cleanup-temp
  if [[ -d "$temp_dir" && "$temp_dir" == "${tmp_root}/${run_id}."* ]]; then
    rm -rf -- "$temp_dir" >/dev/null 2>&1
  fi
  if [[ "$result_emitted" == false ]]; then
    if (( exit_code == 0 )); then
      emit_result PASS
    else
      emit_result FAIL
      printf 'CATEGORY %s\n' "$failure_phase"
    fi
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
trap report_failure ERR

emit_phase initialize
exec 2>/dev/null
provider_mode=${requested_provider_mode:-fake}
case "$provider_mode" in
  fake|real)
    ;;
  *)
    exit 1
    ;;
esac
emit_phase allocate-temp

check_confirm_status_classification() {
  node <<'NODE'
function classifyConfirmStatus(status) {
  if (typeof status !== 'string') return 'confirm-missing';
  if (status === 'UPLOADED') return 'confirm-uploaded';
  if (status === 'PROBING') return 'confirm-probing';
  if (status === 'READY') return 'confirm-ready';
  if (status === 'FAILED') return 'confirm-failed';
  if (status === 'PROCESSING') return 'confirm-processing-unexpected';
  return 'confirm-unknown';
}

const values = [
  [undefined, 'confirm-missing'],
  ['UPLOADED', 'confirm-uploaded'],
  ['PROBING', 'confirm-probing'],
  ['READY', 'confirm-ready'],
  ['FAILED', 'confirm-failed'],
  ['PROCESSING', 'confirm-processing-unexpected'],
  ['OTHER', 'confirm-unknown'],
];
for (const [status, expected] of values) {
  if (classifyConfirmStatus(status) !== expected) process.exit(1);
}
NODE
}

is_allowed_pipeline_stage() {
  case "$1" in
    forward-pending|job-missing|job-pending|job-running|return-pending|projection-pending|job-failed|document-ready|document-failed|unknown)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

check_pipeline_stage_allowlist() {
  local stage
  for stage in forward-pending job-missing job-pending job-running return-pending projection-pending job-failed document-ready document-failed unknown; do
    is_allowed_pipeline_stage "$stage" || return 1
  done
  ! is_allowed_pipeline_stage invalid-stage
}

check_confirm_status_classification
check_pipeline_stage_allowlist

check_media_probe_contract() {
  local env_example="$root/worker/.env.example"
  local key
  for key in \
    MEDIA_PROBE_HEALTH_ADDRESS \
    MEDIA_PROBE_DB_USER \
    MEDIA_PROBE_DB_PASSWORD \
    OBJECT_STORAGE_MEDIA_BUCKET \
    OBJECT_STORAGE_MEDIA_PROBE_ACCESS_KEY \
    OBJECT_STORAGE_MEDIA_PROBE_SECRET_KEY; do
    grep -Eq "^${key}=" "$env_example" || return 1
  done
}

check_media_probe_contract
temp_dir=$(mktemp -d "${tmp_root}/${run_id}.XXXXXX")

find_loopback_port() {
  node -e '
    const net = require("node:net");
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write(String(server.address().port));
      server.close();
    });
  '
}

wait_for_http() {
  local url=$1
  local pid=$2
  local attempts=60
  while (( attempts > 0 )); do
    if curl --fail --silent --show-error --max-time 3 --output /dev/null "$url"; then
      return 0
    fi
    if [[ -n "$pid" ]] && ! kill -0 "$pid" >/dev/null 2>&1; then
      printf 'process-exited\n'
      return 1
    fi
    attempts=$((attempts - 1))
    sleep 1
  done
  printf 'readiness-timeout\n'
  return 1
}

container_port() {
  local container=$1
  local port=$2
  mapped_port "$container" "$port"
}

wait_for_process_http() {
  local phase=$1
  local url=$2
  local pid=$3
  local category
  if category=$(wait_for_http "$url" "$pid"); then
    return 0
  fi
  if [[ "$phase" == wait-node-api && "$category" == process-exited ]]; then
    emit_phase wait-node-api-bootstrap-marker
    category=$(read_bootstrap_category "$api_log" || true)
    [[ -n "$category" ]] || category=unknown
    phase=$PHASE
  fi
  if [[ "$phase" == wait-go-ready && "$category" == process-exited ]]; then
    local go_bootstrap_category
    go_bootstrap_category=$(read_go_bootstrap_category "$go_log" || true)
    [[ -n "$go_bootstrap_category" ]] || go_bootstrap_category=unknown
    emit_phase wait-go-ready-bootstrap-"$go_bootstrap_category"
    phase=$PHASE
  fi
  if [[ "$phase" == wait-media-probe-health || "$phase" == wait-media-probe-ready ]] && [[ "$category" == process-exited ]]; then
    if [[ "$media_probe_container_created" == true ]]; then
      local container_exit_status
      container_exit_status=$(docker inspect --format '{{.State.ExitCode}}' "$media_probe_container" 2>/dev/null || printf 'unknown')
      if [[ "$container_exit_status" =~ ^[0-9]+$ ]]; then
        printf 'MEDIA_PROBE_EXIT_STATUS %s\n' "$container_exit_status"
      else
        printf 'MEDIA_PROBE_EXIT_STATUS unknown\n'
      fi
      local container_bootstrap_code
      container_bootstrap_code=$(docker logs "$media_probe_container" 2>&1 | sed -n 's/.*bootstrap_code[^a-z]*\([a-z][a-z]*\).*/\1/p' | tail -n 1 || true)
      case "$container_bootstrap_code" in
        configuration|probe|database|storage|worker|health|unknown)
          printf 'MEDIA_PROBE_BOOTSTRAP %s\n' "$container_bootstrap_code"
          ;;
        *)
          printf 'MEDIA_PROBE_BOOTSTRAP unknown\n'
          ;;
      esac
      emit_phase wait-media-probe-ready-container-exited
      phase=$PHASE
    else
      local media_probe_bootstrap_category
      media_probe_bootstrap_category=$(read_go_bootstrap_category "$media_probe_log" || true)
      [[ -n "$media_probe_bootstrap_category" ]] || media_probe_bootstrap_category=unknown
      emit_phase wait-media-probe-ready-bootstrap-"$media_probe_bootstrap_category"
      phase=$PHASE
    fi
  fi
  emit_result FAIL
  printf 'CATEGORY %s-%s\n' "$phase" "$category"
  exit 1
}

read_go_bootstrap_category() {
  local logfile=$1
  [[ -f "$logfile" ]] || {
    printf 'unknown\n'
    return 0
  }
  awk -F'"bootstrap_code":"' '
    NF > 1 {
      split($2, category, "\"")
      if (category[1] ~ /^(configuration|provider|migration|database|storage|consumer|probe|worker|health|unknown)$/) {
        print category[1]
        exit
      }
    }
  ' "$logfile" 2>/dev/null || true
}

read_bootstrap_category() {
  local logfile=$1
  [[ -f "$logfile" ]] || return 0
  awk -F= '
    $1 == "BOOTSTRAP_CATEGORY" && $2 ~ /^(configuration|migration|database|storage|module|port|unknown)$/ {
      print $2
      exit
    }
  ' "$logfile" 2>/dev/null
}

read_return_relay_stage() {
  local logfile=$1
  [[ -f "$logfile" ]] || {
    printf 'unknown\n'
    return 0
  }
  awk '
    /ai\.job\.return\.failed/ {
      for (index = 1; index <= NF; index += 1) {
        if ($index ~ /^stage=(outbox-read|parse|quiz-persist|document-project|outbox-publish)$/) {
          sub(/^stage=/, "", $index)
          print $index
          exit
        }
      }
    }
  ' "$logfile" 2>/dev/null || true
}

mapped_port() {
  local container=$1
  local container_port=$2
  docker inspect --format "{{(index (index .NetworkSettings.Ports \"${container_port}/tcp\") 0).HostPort}}" "$container"
}

start_node_api() {
  api_log="$temp_dir/node-api.log"
  (
    cd "$root/app"
    export NODE_ENV=development
    export IDENTITY_MODE=stub
    # The local fixture must not inherit developer mTLS paths from app/.env.
    export INTERNAL_MTLS_CA_PATH=
    export INTERNAL_MTLS_CERT_PATH=
    export INTERNAL_MTLS_KEY_PATH=
    export INTERNAL_MTLS_EXPECTED_CLIENT_SPIFFE_URI=
    export INTERNAL_MTLS_EXPECTED_WEB_BFF_SPIFFE_URI=
    export PORT="$api_port"
    export AI_LLM_PROVIDER=fake
    export AI_CREDENTIAL_ENCRYPTION_MODE=local
    export AI_CREDENTIAL_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
    export GOOGLE_CLIENT_ID=local-document-e2e-client-id
    export GOOGLE_CLIENT_SECRET=local-document-e2e-client-secret
    export GOOGLE_REDIRECT_URI=http://127.0.0.1/auth/google/callback
    export AUTH_OAUTH_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
    export SWAGGER_ENABLED=false
    export DB_HOST=127.0.0.1
    export DB_PORT="$postgres_port"
    export DB_USER=learning
    export DB_PASSWORD=learning
    export DB_NAME=learning
    export DB_SSL_MODE=disabled
    export DB_SSL_CA=
    export OBJECT_STORAGE_ENDPOINT=127.0.0.1
    export OBJECT_STORAGE_PORT="$minio_port"
    export OBJECT_STORAGE_REGION=us-east-1
    export OBJECT_STORAGE_USE_SSL=false
    export OBJECT_STORAGE_ACCESS_KEY=minioadmin
    export OBJECT_STORAGE_SECRET_KEY=minioadmin
    export OBJECT_STORAGE_BUCKET=documents
    export OBJECT_STORAGE_API_MEDIA_ACCESS_KEY=minioadmin
    export OBJECT_STORAGE_API_MEDIA_SECRET_KEY=minioadmin
    export OBJECT_STORAGE_MEDIA_ENABLED=true
    export OBJECT_STORAGE_MEDIA_BUCKET=media
    export OBJECT_STORAGE_PRESIGN_EXPIRY=300
    exec ./node_modules/.bin/ts-node -T -e '
const mainPath = process.argv[1];

function classifyBootstrapFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/cannot find module|module not found|ERR_MODULE_NOT_FOUND/i.test(message)) return "module";
  if (/migration|migrat(e|ion|ions|ed)/i.test(message)) return "migration";
  if (/storage|s3|minio|bucket|object.?storage/i.test(message)) return "storage";
  if (/EADDRINUSE|EACCES|listen|port/i.test(message)) return "port";
  if (/database|postgres|pg_|typeorm|connection refused|ECONNREFUSED/i.test(message)) return "database";
  if (/configuration|config|environment|env(ironment)? variable|invalid.*(value|port)/i.test(message)) return "configuration";
  return "unknown";
}

void (async () => {
  try {
    const { bootstrapApi } = require(mainPath);
    await bootstrapApi();
  } catch (error) {
    process.stderr.write(`BOOTSTRAP_ERROR=${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(`BOOTSTRAP_CATEGORY=${classifyBootstrapFailure(error)}\n`);
    process.exitCode = 1;
  }
})();
' "$root/app/src/main.ts"
  ) >"$api_log" 2>&1 &
  api_pid=$!
}

start_node_relay() {
  relay_log="$temp_dir/node-relay.log"
  (
    cd "$root/app"
    export NODE_ENV=development
    export IDENTITY_MODE=stub
    export INTERNAL_MTLS_CA_PATH=
    export INTERNAL_MTLS_CERT_PATH=
    export INTERNAL_MTLS_KEY_PATH=
    export INTERNAL_MTLS_EXPECTED_CLIENT_SPIFFE_URI=
    export INTERNAL_MTLS_EXPECTED_WEB_BFF_SPIFFE_URI=
    export PORT="$relay_health_port"
    export AI_LLM_PROVIDER=fake
    export AI_CREDENTIAL_ENCRYPTION_MODE=local
    export AI_CREDENTIAL_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
    export SWAGGER_ENABLED=false
    export DB_HOST=127.0.0.1
    export DB_PORT="$postgres_port"
    export DB_USER=learning
    export DB_PASSWORD=learning
    export DB_NAME=learning
    export DB_SSL_MODE=disabled
    export DB_SSL_CA=
    export WORKER_EXECUTION_MODE=relay-only
    export WORKER_HEALTH_HOST=127.0.0.1
    export WORKER_HEALTH_PORT="$relay_health_port"
    export OBJECT_STORAGE_ENDPOINT=127.0.0.1
    export OBJECT_STORAGE_PORT="$minio_port"
    export OBJECT_STORAGE_REGION=us-east-1
    export OBJECT_STORAGE_USE_SSL=false
    export OBJECT_STORAGE_ACCESS_KEY=minioadmin
    export OBJECT_STORAGE_SECRET_KEY=minioadmin
    export OBJECT_STORAGE_BUCKET=documents
    export OBJECT_STORAGE_API_MEDIA_ACCESS_KEY=minioadmin
    export OBJECT_STORAGE_API_MEDIA_SECRET_KEY=minioadmin
    export OBJECT_STORAGE_MEDIA_ENABLED=true
    export OBJECT_STORAGE_MEDIA_BUCKET=media
    export OBJECT_STORAGE_PRESIGN_EXPIRY=300
    exec ./node_modules/.bin/ts-node -T src/worker.ts
  ) >"$relay_log" 2>&1 &
  relay_pid=$!
}

start_go_worker() {
  go_log="$temp_dir/go-worker.log"
  (
    set -a
    source "$root/worker/.env"
    set +a
    if [[ "$provider_mode" == fake ]]; then
      export AI_LLM_PROVIDER=fake
    else
      [[ "${AI_LLM_PROVIDER:-}" == openai-compatible ]]
    fi
    unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_DEFAULT_REGION AWS_REGION AWS_PROFILE AWS_CONFIG_FILE AWS_SHARED_CREDENTIALS_FILE AWS_WEB_IDENTITY_TOKEN_FILE AWS_ROLE_ARN AWS_ROLE_SESSION_NAME
    export NODE_ENV=development
    export AI_WORKER_ALLOW_INSECURE_LOCAL_ENDPOINTS=true
    export AI_WORKER_HEALTH_ADDRESS="127.0.0.1:${go_health_port}"
    export AI_WORKER_CONCURRENCY=1
    export AI_WORKER_POLL_INTERVAL_MS=100
    export DB_HOST=127.0.0.1
    export DB_PORT="$postgres_port"
    export DB_USER=learning
    export DB_PASSWORD=learning
    export DB_NAME=learning
    export OBJECT_STORAGE_ENDPOINT=127.0.0.1
    export OBJECT_STORAGE_PORT="$minio_port"
    export OBJECT_STORAGE_REGION=us-east-1
    export OBJECT_STORAGE_USE_SSL=false
    export OBJECT_STORAGE_ACCESS_KEY=minioadmin
    export OBJECT_STORAGE_SECRET_KEY=minioadmin
    export OBJECT_STORAGE_BUCKET=documents
    export AI_WORKER_MIGRATIONS_DIR="$root/app/src/database/migrations"
    exec "$temp_dir/ai-worker"
  ) >"$go_log" 2>&1 &
  go_pid=$!
}

read_ffprobe_version() {
  "$1" -version 2>/dev/null | awk 'NR == 1 && $1 == "ffprobe" && $2 == "version" { sub(/^n/, "", $3); print $3 }'
}

start_media_probe_worker() {
  media_probe_log="$temp_dir/media-probe-worker.log"
  if [[ -n "${LOCAL_DOCUMENT_E2E_MEDIA_PROBE_IMAGE:-}" ]]; then
    docker run --detach \
      --name "$media_probe_container" \
      --network "$network_name" \
      -p "127.0.0.1:${media_probe_health_port}:3404" \
      --read-only \
      --tmpfs /tmp/media-probe:rw,noexec,nosuid,size=512m,uid=65532,gid=65532,mode=0700 \
      --env NODE_ENV=development \
      --env AI_WORKER_ALLOW_INSECURE_LOCAL_ENDPOINTS=true \
      --env MEDIA_PROBE_HEALTH_ADDRESS=0.0.0.0:3404 \
      --env DB_HOST="$postgres_container" \
      --env DB_PORT=5432 \
      --env DB_NAME=learning \
      --env MEDIA_PROBE_DB_USER=learning_platform_media_probe \
      --env MEDIA_PROBE_DB_PASSWORD=media_probe_local \
      --env OBJECT_STORAGE_ENDPOINT="$minio_container" \
      --env OBJECT_STORAGE_PORT=9000 \
      --env OBJECT_STORAGE_REGION=us-east-1 \
      --env OBJECT_STORAGE_USE_SSL=false \
      --env OBJECT_STORAGE_MEDIA_BUCKET=media \
      --env OBJECT_STORAGE_MEDIA_PROBE_ACCESS_KEY=minioadmin \
      --env OBJECT_STORAGE_MEDIA_PROBE_SECRET_KEY=minioadmin \
      "$LOCAL_DOCUMENT_E2E_MEDIA_PROBE_IMAGE" >/dev/null 2>&1
    media_probe_container_created=true
    return
  fi
  (
    set -a
    source "$root/worker/.env"
    set +a
    unset AI_LLM_PROVIDER OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_DEFAULT_REGION AWS_REGION AWS_PROFILE AWS_CONFIG_FILE AWS_SHARED_CREDENTIALS_FILE AWS_WEB_IDENTITY_TOKEN_FILE AWS_ROLE_ARN AWS_ROLE_SESSION_NAME
    export NODE_ENV=development
    export AI_WORKER_ALLOW_INSECURE_LOCAL_ENDPOINTS=true
    export MEDIA_PROBE_HEALTH_ADDRESS="127.0.0.1:${media_probe_health_port}"
    export DB_HOST=127.0.0.1
    export DB_PORT="$postgres_port"
    export DB_NAME=learning
    export MEDIA_PROBE_DB_USER=learning_platform_media_probe
    export MEDIA_PROBE_DB_PASSWORD=media_probe_local
    export OBJECT_STORAGE_ENDPOINT=127.0.0.1
    export OBJECT_STORAGE_PORT="$minio_port"
    export OBJECT_STORAGE_REGION=us-east-1
    export OBJECT_STORAGE_USE_SSL=false
    export OBJECT_STORAGE_MEDIA_BUCKET=media
    export OBJECT_STORAGE_MEDIA_PROBE_ACCESS_KEY=minioadmin
    export OBJECT_STORAGE_MEDIA_PROBE_SECRET_KEY=minioadmin
    export MEDIA_PROBE_FFPROBE_PATH="${MEDIA_PROBE_FFPROBE_PATH:-$(command -v ffprobe)}"
    # Native runs use the host ffprobe, so pin the version that binary reports instead of the image artifact version.
    MEDIA_PROBE_FFPROBE_VERSION=$(read_ffprobe_version "$MEDIA_PROBE_FFPROBE_PATH")
    [[ -n "$MEDIA_PROBE_FFPROBE_VERSION" ]] || exit 1
    export MEDIA_PROBE_FFPROBE_VERSION
    export MEDIA_PROBE_TEMP_DIR="$temp_dir/media-probe"
    export AI_WORKER_MIGRATIONS_DIR="$root/app/src/database/migrations"
    exec "$temp_dir/media-probe-worker"
  ) >"$media_probe_log" 2>&1 &
  media_probe_pid=$!
}

run_document_flow() {
  node - "http://127.0.0.1:${api_port}" "$auth_owner_id" "$auth_access_token" <<'NODE'
const apiBaseUrl = process.argv[2];
const ownerId = process.argv[3];
const accessToken = process.argv[4];
const fs = require('node:fs');
const inputPath = process.env.LOCAL_DOCUMENT_E2E_INPUT_PATH;
const input = inputPath
  ? fs.readFileSync(inputPath)
  : Buffer.alloc(0);
const inputType = 'AUDIO';
const originalName = 'document-e2e.mp3';
const contentType = 'audio/mpeg';
const requestTimeoutMs = 10_000;
const pollDeadlineMs = 120_000;
const pollIntervalMs = 1_000;
let phase = 'unknown';

class FlowFailure extends Error {
  constructor(marker) {
    super();
    this.marker = marker;
  }
}

function requireMarker(condition, marker) {
  if (!condition) throw new FlowFailure(marker);
}

function formatHttpStatusMarker(name, status) {
  return `HTTP ${name} ${status}\n`;
}

requireMarker(
  formatHttpStatusMarker('presigned-upload', 204) === 'HTTP presigned-upload 204\n',
  'presigned-upload-marker-regression',
);

async function request(url, init = {}) {
  let response;
  const parsedUrl = new URL(url);
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) });
  } catch (error) {
    let current = error;
    let code;
    let causeCode;
    for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
      if ('code' in current && typeof current.code === 'string') {
        causeCode = code;
        code = current.code;
      }
      current = 'cause' in current ? current.cause : undefined;
    }
    const message = error instanceof Error ? error.message : '';
    const category = code === 'ECONNREFUSED' ? 'connection-refused'
      : code === 'ENOTFOUND' ? 'name-resolution'
        : code === 'ETIMEDOUT' ? 'timeout'
          : code === 'EAI_AGAIN' ? 'temporary-name-resolution'
            : /invalid url/i.test(message) ? 'invalid-url'
              : 'fetch-failed';
    const errorName = error instanceof Error && /^(TypeError|TimeoutError|AbortError)$/u.test(error.name)
      ? error.name : 'Error';
    const safeCode = typeof code === 'string' && /^[A-Z0-9_]{1,40}$/u.test(code) ? code : 'UNKNOWN';
    const safeCauseCode = typeof causeCode === 'string' && /^[A-Z0-9_]{1,40}$/u.test(causeCode) ? causeCode : 'UNKNOWN';
    process.stdout.write(`NETWORK_ERROR phase=${phase} category=${category} error=${errorName} code=${safeCode} causeCode=${safeCauseCode}\n`);
    throw new FlowFailure('network');
  }
  if (!response.ok) throw new FlowFailure(phase);
  return response;
}

async function requestJson(path, init = {}) {
  const response = await request(`${apiBaseUrl}${path}`, init);
  return response.json();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  phase = 'upload-url';
  const upload = await requestJson('/api/v1/documents/upload-url', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      modelSelectionKind: 'PLAN',
      originalName,
      platformModelId: 'platform-default',
      sizeBytes: input.length,
      type: inputType,
    }),
  });
  requireMarker(
    typeof upload.documentId === 'string' &&
      typeof upload.uploadUrl === 'string' &&
      upload.uploadFields &&
      typeof upload.uploadFields === 'object',
    'upload-contract',
  );
  requireMarker(typeof upload.uploadUrl === 'string' && upload.uploadUrl.length > 0, 'upload-contract');
  process.stdout.write('HTTP upload-url 201\n');

  const form = new FormData();
  for (const [key, value] of Object.entries(upload.uploadFields)) form.set(key, String(value));
  form.set('file', new Blob([input], { type: contentType }), originalName);
  phase = 'presigned-upload';
  const uploaded = await request(upload.uploadUrl, { method: 'POST', body: form });
  process.stdout.write(formatHttpStatusMarker('presigned-upload', uploaded.status));
  phase = 'uploaded-status';
  const uploadedDocument = await requestJson(`/api/v1/documents/${upload.documentId}`, { headers });
  requireMarker(uploadedDocument.status === 'UPLOADED', 'uploaded-status');
  process.stdout.write('DOCUMENT_STATUS UPLOADED\n');

  phase = 'confirm';
  const confirmed = await requestJson(`/api/v1/documents/${upload.documentId}/confirm`, {
    method: 'POST',
    headers,
  });
  function classifyConfirmStatus(status) {
    if (typeof status !== 'string') return 'confirm-missing';
    if (status === 'UPLOADED') return 'confirm-uploaded';
    if (status === 'PROBING') return 'confirm-probing';
    if (status === 'READY') return 'confirm-ready';
    if (status === 'FAILED') return 'confirm-failed';
    if (status === 'PROCESSING') return 'confirm-processing-unexpected';
    return 'confirm-unknown';
  }
  requireMarker(confirmed.status === 'PROBING', classifyConfirmStatus(confirmed.status));
  process.stdout.write('HTTP confirm 202\n');
  process.stdout.write('DOCUMENT_STATUS PROBING\n');

  const deadline = Date.now() + pollDeadlineMs;
  let processing = false;
  while (Date.now() < deadline) {
    phase = 'document-status';
    const document = await requestJson(`/api/v1/documents/${upload.documentId}`, { headers });
    if (document.status === 'PROCESSING') {
      if (!processing) process.stdout.write('DOCUMENT_STATUS PROCESSING\n');
      processing = true;
      break;
    }
    if (document.status === 'FAILED') throw new FlowFailure('document-failed');
    await sleep(pollIntervalMs);
  }

  if (!processing) throw new FlowFailure('document-timeout');
  // #158 stops after media probing; AUDIO/VIDEO extraction and READY belong to #160.
  process.stdout.write(`DOCUMENT_ID ${upload.documentId}\n`);
}

void main().catch((error) => {
  const marker = error instanceof FlowFailure ? error.marker : 'unknown';
  process.stdout.write(`${marker}\n`);
  process.exitCode = 1;
});
NODE
}

seed_auth_fixture() {
  auth_owner_id=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
  auth_access_token=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')
  local token_hash
  token_hash=$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1], "utf8").digest("hex"))' "$auth_access_token")
  printf '%s\n' '
INSERT INTO "auth"."users"
  ("id", "google_sub", "normalized_email", "email_verified", "role", "status", "deleted_at")
VALUES (:'"'"'owner_id'"'"', :'"'"'google_sub'"'"', :'"'"'email'"'"', true, '"'"'USER'"'"', '"'"'ACTIVE'"'"', NULL);
INSERT INTO "auth"."user_profiles" ("user_id") VALUES (:'"'"'owner_id'"'"');
INSERT INTO "auth"."sessions"
  ("user_id", "session_family_id", "token_type", "token_hash", "expires_at")
VALUES (:'"'"'owner_id'"'"', gen_random_uuid(), '"'"'ACCESS'"'"', :'"'"'token_hash'"'"', now() + interval '"'"'15 minutes'"'"');
' | docker exec -i "$postgres_container" psql \
    --no-psqlrc --quiet \
    --set=ON_ERROR_STOP=1 \
    --set=owner_id="$auth_owner_id" \
    --set=google_sub="local-document-e2e-$auth_owner_id" \
    --set=email="$auth_owner_id@example.test" \
    --set=token_hash="$token_hash" \
    --username=learning --dbname=learning \
    >/dev/null 2>&1
}

seed_media_probe_role() {
  local role_exists
  role_exists=$(docker exec "$postgres_container" psql \
    --no-psqlrc --tuples-only --no-align --quiet \
    --set=ON_ERROR_STOP=1 \
    --username=learning --dbname=learning \
    --command "SELECT 1 FROM pg_roles WHERE rolname = 'learning_platform_media_probe';")
  if [[ "$role_exists" != "1" ]]; then
    docker exec "$postgres_container" psql \
      --no-psqlrc --quiet \
      --set=ON_ERROR_STOP=1 \
      --username=learning --dbname=learning \
      --command "CREATE ROLE learning_platform_media_probe LOGIN PASSWORD 'media_probe_local' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;"
  else
    docker exec "$postgres_container" psql \
      --no-psqlrc --quiet \
      --set=ON_ERROR_STOP=1 \
      --username=learning --dbname=learning \
      --command "ALTER ROLE learning_platform_media_probe LOGIN PASSWORD 'media_probe_local';"
  fi
}

run_s3_round_trip() {
  (
    cd "$root/app"
    node - "$minio_port" <<'NODE'
const { ConfigService } = require('@nestjs/config');
const { Logger } = require('@nestjs/common');
const {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');
const { ApplicationConfigService } = require('./dist/config/application-config.service.js');
const { StorageService } = require('./dist/storage/storage.service.js');

const port = process.argv[2];
const bucket = 'documents';
const accessKeyId = 'minioadmin';
const secretAccessKey = 'minioadmin';
const contentType = 'text/plain';
const content = Buffer.from('S3-compatible storage round trip.');
const objectKey = `regression/${require('node:crypto').randomUUID()}.txt`;
const endpoint = `http://127.0.0.1:${port}`;
const client = new S3Client({
  credentials: { accessKeyId, secretAccessKey },
  endpoint,
  forcePathStyle: true,
  region: 'us-east-1',
});
const service = new StorageService(new ApplicationConfigService(new ConfigService({
  app: { env: 'development' },
  storage: {
    accessKey: accessKeyId,
    bucket,
    endpoint: '127.0.0.1',
    port: Number(port),
    presignExpiry: 300,
    region: 'us-east-1',
    secretKey: secretAccessKey,
    useSSL: false,
  },
})));
Logger.overrideLogger(false);

function requireCondition(condition) {
  if (!condition) throw new Error('S3 round trip contract failed');
}

async function postForm(upload, fields, bytes, fileType) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set('file', new Blob([bytes], { type: fileType }), 'round-trip.txt');
  const response = await fetch(upload.url, { method: 'POST', body: form });
  await response.arrayBuffer();
  return response;
}

async function expectRejectedUpload(policyName, attemptedKey, upload, fields, bytes, fileType) {
  const response = await postForm(upload, fields, bytes, fileType);
  process.stdout.write(`S3_POLICY ${policyName} status=${response.status}\n`);
  requireCondition(!response.ok);
  requireCondition(response.status === 400 || response.status === 403);
  let objectExists = false;
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: attemptedKey }));
    objectExists = true;
  } catch (error) {
    const metadata = error && typeof error === 'object' && '$metadata' in error
      ? error.$metadata
      : undefined;
    const status = metadata && typeof metadata === 'object' ? metadata.httpStatusCode : undefined;
    requireCondition(status === 404);
  }
  requireCondition(!objectExists);
  process.stdout.write(`S3_POLICY ${policyName} rejected\n`);
}

async function main() {
  const cleanupKeys = new Set([objectKey]);
  try {
    await service.onModuleInit();
    const upload = await service.createPresignedPostUrl(objectKey, contentType, content.length);
    requireCondition(new URL(upload.url).hostname === '127.0.0.1');
    requireCondition(upload.formFields.Policy);
    requireCondition(upload.formFields['X-Amz-Algorithm']);
    requireCondition(upload.formFields['X-Amz-Credential']);
    requireCondition(upload.formFields['X-Amz-Date']);
    requireCondition(upload.formFields['X-Amz-Signature']);
    requireCondition(upload.formFields['Content-Type'] === contentType);
    requireCondition(upload.formFields.bucket === bucket);
    requireCondition(upload.formFields.key === objectKey);

    const response = await postForm(upload, upload.formFields, content, contentType);
    requireCondition(response.ok);

    const stat = await service.statObject(objectKey);
    requireCondition(stat.size === content.length && stat.contentType === contentType);
    requireCondition((await service.readHead(objectKey, content.length)).equals(content));
    requireCondition((await service.readObject(objectKey, content.length)).equals(content));

    const wrongKey = `${objectKey}-wrong-key`;
    cleanupKeys.add(wrongKey);
    const wrongKeyUpload = await service.createPresignedPostUrl(objectKey, contentType, content.length);
    await expectRejectedUpload(
      'wrong-key',
      wrongKey,
      wrongKeyUpload,
      { ...wrongKeyUpload.formFields, key: wrongKey },
      content,
      contentType,
    );

    const wrongMimeKey = `${objectKey}-wrong-mime`;
    cleanupKeys.add(wrongMimeKey);
    const wrongMimeUpload = await service.createPresignedPostUrl(wrongMimeKey, contentType, content.length);
    await expectRejectedUpload(
      'wrong-mime',
      wrongMimeKey,
      wrongMimeUpload,
      { ...wrongMimeUpload.formFields, 'Content-Type': 'application/octet-stream' },
      content,
      'application/octet-stream',
    );

    const wrongSizeKey = `${objectKey}-wrong-size`;
    cleanupKeys.add(wrongSizeKey);
    const wrongSizeUpload = await service.createPresignedPostUrl(wrongSizeKey, contentType, content.length);
    await expectRejectedUpload(
      'wrong-size',
      wrongSizeKey,
      wrongSizeUpload,
      wrongSizeUpload.formFields,
      Buffer.concat([content, Buffer.from('x')]),
      contentType,
    );
  } finally {
    for (const key of cleanupKeys) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    }
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
NODE
  )
}

configure_minio_buckets() {
  (
    cd "$root/app"
    node - "$minio_port" <<'NODE'
const {
  CreateBucketCommand,
  GetBucketVersioningCommand,
  PutBucketVersioningCommand,
  S3Client,
} = require('@aws-sdk/client-s3');

const port = process.argv[2];
const client = new S3Client({
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
  endpoint: `http://127.0.0.1:${port}`,
  forcePathStyle: true,
  region: 'us-east-1',
});

async function main() {
  await client.send(new CreateBucketCommand({ Bucket: 'documents' }));
  await client.send(new CreateBucketCommand({ Bucket: 'media' }));
  await client.send(new PutBucketVersioningCommand({
    Bucket: 'media',
    VersioningConfiguration: { Status: 'Enabled' },
  }));
  const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: 'media' }));
  if (versioning.Status !== 'Enabled') {
    throw new Error('MinIO media bucket versioning is not enabled');
  }
}

void main().catch((error) => {
  process.stderr.write(`${error.name || 'Error'}: MinIO bucket configuration failed\n`);
  process.exitCode = 1;
});
NODE
  )
}

classify_pipeline_stage() {
  local stage
  if ! stage=$(docker exec "$postgres_container" psql \
    --no-psqlrc --tuples-only --no-align --quiet \
    --set=ON_ERROR_STOP=1 \
    --username=learning --dbname=learning \
    --command '
WITH stages AS (
  SELECT CASE
    WHEN document.status = $stage$READY$stage$ THEN $marker$document-ready$marker$
    WHEN document.status = $stage$FAILED$stage$ THEN $marker$document-failed$marker$
    WHEN bool_or(ai_outbox.aggregate_id IS NOT NULL AND ai_outbox.published_at IS NOT NULL) THEN $marker$projection-pending$marker$
    WHEN bool_or(ai_outbox.aggregate_id IS NOT NULL AND ai_outbox.published_at IS NULL)
      OR bool_or(job.status = $stage$COMPLETED$stage$) THEN $marker$return-pending$marker$
    WHEN bool_or(job.status = $stage$FAILED$stage$) THEN $marker$job-failed$marker$
    WHEN bool_or(job.status = $stage$RUNNING$stage$) THEN $marker$job-running$marker$
    WHEN bool_or(job.status = $stage$PENDING$stage$) THEN $marker$job-pending$marker$
    WHEN bool_or(course_outbox.aggregate_id IS NOT NULL AND course_outbox.published_at IS NOT NULL) THEN $marker$job-missing$marker$
    WHEN bool_or(course_outbox.aggregate_id IS NOT NULL AND course_outbox.published_at IS NULL) THEN $marker$forward-pending$marker$
    ELSE $marker$unknown$marker$
  END AS marker
  FROM course.documents AS document
  LEFT JOIN course.outbox AS course_outbox ON course_outbox.aggregate_id = document.id
  LEFT JOIN ai.processing_jobs AS job ON job.document_id = document.id
  LEFT JOIN ai.outbox AS ai_outbox ON ai_outbox.aggregate_id = job.id
  WHERE document.status IN ($stage$PROCESSING$stage$, $stage$READY$stage$, $stage$FAILED$stage$)
  GROUP BY document.id, document.status
), ranked AS (
  SELECT marker, CASE marker
    WHEN $marker$document-ready$marker$ THEN 9
    WHEN $marker$document-failed$marker$ THEN 9
    WHEN $marker$projection-pending$marker$ THEN 8
    WHEN $marker$return-pending$marker$ THEN 7
    WHEN $marker$job-failed$marker$ THEN 6
    WHEN $marker$job-running$marker$ THEN 5
    WHEN $marker$job-pending$marker$ THEN 4
    WHEN $marker$job-missing$marker$ THEN 3
    WHEN $marker$forward-pending$marker$ THEN 2
    ELSE 1
  END AS rank
  FROM stages
)
SELECT marker
FROM ranked
ORDER BY rank DESC, marker ASC
LIMIT 1;
' 2>/dev/null); then
    printf 'unknown\n'
    return 0
  fi
  if is_allowed_pipeline_stage "$stage"; then
    printf '%s\n' "$stage"
  else
    printf 'unknown\n'
  fi
}

read_document_failure_code() {
  docker exec "$postgres_container" psql \
    --no-psqlrc --tuples-only --no-align --quiet \
    --set=ON_ERROR_STOP=1 \
    --set=document_id="$document_id" \
    --username=learning --dbname=learning \
    --command 'SELECT COALESCE((SELECT failure_code FROM ai.processing_jobs WHERE document_id = :\x27document_id\x27 ORDER BY created_at DESC LIMIT 1), \x27NONE\x27);' 2>/dev/null || printf 'UNKNOWN\n'
}

verify_media_probe_flow() {
  local row
  local attempts=120

  while (( attempts > 0 )); do
    if row=$(printf '%s\n' "
SELECT concat_ws(E'\n',
  'DOCUMENT_STATUS ' || document.status,
  'MEDIA_PROBE_STATUS ' || probe.status,
  'MEDIA_PROBE_VERSION_ID ' || probe.source_version_id,
  'MEDIA_PROBE_RESULT_VERSION_ID ' || result.version_id,
  'FULL_PIPELINE_JOB_TYPE ' || pipeline.job_type,
  'FULL_PIPELINE_JOB_STATUS ' || pipeline.status,
  'FULL_PIPELINE_JOB_COUNT ' || (
    SELECT COUNT(*)::text
    FROM ai.processing_jobs
    WHERE document_id = document.id AND job_type = 'FULL_PIPELINE'
  )
)
FROM course.documents AS document
JOIN ai.media_probe_jobs AS probe ON probe.document_id = document.id
LEFT JOIN ai.media_probe_results AS result ON result.id = probe.probe_result_id
LEFT JOIN ai.processing_jobs AS pipeline
  ON pipeline.id = probe.full_pipeline_job_id
 AND pipeline.job_type = 'FULL_PIPELINE'
WHERE document.id = :'document_id'
  AND document.status = 'PROCESSING'
  AND probe.status = 'COMPLETED'
  AND probe.source_version_id IS NOT NULL
  AND result.version_id IS NOT NULL
  AND probe.source_version_id = result.version_id
  AND pipeline.job_type = 'FULL_PIPELINE'
  AND pipeline.status IN ('PENDING', 'RUNNING')
  AND (
    SELECT COUNT(*)
    FROM ai.processing_jobs
    WHERE document_id = document.id AND job_type = 'FULL_PIPELINE'
  ) = 1
ORDER BY probe.created_at DESC, pipeline.created_at DESC NULLS LAST
LIMIT 1;
" | docker exec -i "$postgres_container" psql \
      --no-psqlrc --tuples-only --no-align --quiet \
      --pset=footer=off \
      --set=ON_ERROR_STOP=1 \
      --set=document_id="$document_id" \
      --username=learning --dbname=learning); then
      if [[ -n "$row" ]]; then
        printf '%s\n' "$row"
        return 0
      fi
    fi
    attempts=$((attempts - 1))
    sleep 1
  done
  printf 'MEDIA_PROBE_EVIDENCE unavailable\n'
  return 1
}

emit_phase build-app
npm --prefix "$root/app" run build >/dev/null 2>&1
emit_phase build-go
go build -C "$root/worker" -o "$temp_dir/ai-worker" ./cmd/ai-worker >/dev/null 2>&1
go build -C "$root/worker" -o "$temp_dir/media-probe-worker" ./cmd/media-probe-worker >/dev/null 2>&1

emit_phase allocate-ports
api_port=${LOCAL_DOCUMENT_E2E_API_PORT:-3010}
relay_health_port=$(find_loopback_port)
go_health_port=$(find_loopback_port)
media_probe_health_port=$(find_loopback_port)

emit_phase create-network
docker network create "$network_name" >/dev/null 2>&1
network_created=true
emit_phase create-postgres-volume
docker volume create "$postgres_volume" >/dev/null 2>&1
postgres_volume_created=true
emit_phase create-minio-volume
docker volume create "$minio_volume" >/dev/null 2>&1
minio_volume_created=true

emit_phase start-postgres
docker run --detach \
  --name "$postgres_container" \
  --network "$network_name" \
  -p 127.0.0.1::5432 \
  --env POSTGRES_USER=learning \
  --env POSTGRES_PASSWORD=learning \
  --env POSTGRES_DB=learning \
  --volume "$postgres_volume:/var/lib/postgresql/data" \
postgres:16-alpine >/dev/null 2>&1
postgres_container_created=true

emit_phase start-minio
docker run --detach \
  --name "$minio_container" \
  --network "$network_name" \
  -p 127.0.0.1::9000 \
  --env MINIO_ROOT_USER=minioadmin \
  --env MINIO_ROOT_PASSWORD=minioadmin \
  --volume "$minio_volume:/bitnami/minio/data" \
  "$minio_image" /opt/bitnami/scripts/minio/run.sh >/dev/null 2>&1
minio_container_created=true

emit_phase allocate-postgres-port
postgres_port=$(mapped_port "$postgres_container" 5432)
emit_phase allocate-minio-port
minio_port=$(mapped_port "$minio_container" 9000)

emit_phase dependencies
attempts=60
emit_phase wait-postgres
until docker exec "$postgres_container" pg_isready --username=learning --dbname=learning >/dev/null 2>&1; do
  attempts=$((attempts - 1))
  (( attempts > 0 )) || exit 1
  sleep 1
done
emit_phase wait-minio
wait_for_http "http://127.0.0.1:${minio_port}/minio/health/live" "" >/dev/null
emit_phase configure-minio
configure_minio_buckets
emit_phase create-media-fixture
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i sine=frequency=1000:duration=1 \
  -c:a libmp3lame -q:a 9 \
  "$temp_dir/document-e2e.mp3" >/dev/null 2>&1
export LOCAL_DOCUMENT_E2E_INPUT_PATH="$temp_dir/document-e2e.mp3"

emit_phase storage-round-trip
run_s3_round_trip

emit_phase node
emit_phase seed-media-probe-role
seed_media_probe_role
emit_phase start-node-api
start_node_api
emit_phase wait-node-api
wait_for_process_http wait-node-api "http://127.0.0.1:${api_port}/api/v1/health" "$api_pid"
emit_phase seed-auth-fixture
seed_auth_fixture
emit_phase start-node-relay
start_node_relay
emit_phase wait-node-relay
wait_for_process_http wait-node-relay "http://127.0.0.1:${relay_health_port}/health" "$relay_pid"

emit_phase go
emit_phase start-media-probe
start_media_probe_worker
if [[ "$media_probe_container_created" == true ]]; then
  media_probe_pid=""
fi
emit_phase wait-media-probe-health
if [[ "$media_probe_container_created" == true ]]; then
  wait_for_process_http wait-media-probe-health "http://127.0.0.1:${media_probe_health_port}/healthz" ""
  emit_phase wait-media-probe-ready
  wait_for_process_http wait-media-probe-ready "http://127.0.0.1:${media_probe_health_port}/readyz" ""
else
  wait_for_process_http wait-media-probe-health "http://127.0.0.1:${media_probe_health_port}/healthz" "$media_probe_pid"
  emit_phase wait-media-probe-ready
  wait_for_process_http wait-media-probe-ready "http://127.0.0.1:${media_probe_health_port}/readyz" "$media_probe_pid"
fi

emit_phase document-flow
document_flow_result="$temp_dir/document-flow-result"
document_flow_error="$temp_dir/document-flow-error"
if ! run_document_flow >"$document_flow_result" 2>"$document_flow_error"; then
  PHASE=document-flow-marker
  minio_state=$(docker inspect --format '{{.State.Status}}' "$minio_container" 2>/dev/null || printf 'unknown')
  printf 'MINIO_STATE %s\n' "$minio_state"
  docker logs "$minio_container" 2>&1 \
    | rg -o 'SignatureDoesNotMatch|AccessDenied|InvalidRequest|IncompleteBody|EntityTooLarge|InvalidBucketName|ConnectionClosed|write tcp' \
    | sort | uniq -c | awk '{ print "MINIO_SIGNAL " $2 " count=" $1 }' || true
  rg '^NETWORK_ERROR phase=(presigned-upload|upload-url|uploaded-status|confirm|document-status) category=[a-z-]+ error=[A-Za-z]+ code=[A-Z0-9_]+ causeCode=[A-Z0-9_]+' "$document_flow_result" || true
  document_flow_marker=$(tail -n 1 "$document_flow_result")
  case "$document_flow_marker" in
    upload-url|presigned-upload|uploaded-status|confirm|document-failed|document-timeout|document-status|document-quiz|quiz-endpoint|network|upload-contract|confirm-missing|confirm-uploaded|confirm-probing|confirm-ready|confirm-failed|confirm-processing-unexpected|confirm-unknown|ready-status|processing-status|document-quiz-contract|question-count|quiz-contract|quiz-learner-projection|unknown)
      printf 'DOCUMENT_FLOW_MARKER %s\n' "$document_flow_marker"
      ;;
    *)
      printf 'DOCUMENT_FLOW_MARKER unknown\n'
      ;;
  esac
  pipeline_stage=$(classify_pipeline_stage)
  printf 'PIPELINE_STAGE %s\n' "$pipeline_stage"
  document_failure_code=$(read_document_failure_code)
  case "$document_failure_code" in
    [A-Z_]*|NONE|UNKNOWN)
      printf 'DOCUMENT_FAILURE_CODE %s\n' "$document_failure_code"
      ;;
    *)
      printf 'DOCUMENT_FAILURE_CODE UNKNOWN\n'
      ;;
  esac
  if [[ "$pipeline_stage" == return-pending ]]; then
    return_relay_stage=$(read_return_relay_stage "$relay_log")
    case "$return_relay_stage" in
      outbox-read|parse|quiz-persist|document-project|outbox-publish)
        printf 'RETURN_RELAY_STAGE %s\n' "$return_relay_stage"
        ;;
      *)
        printf 'RETURN_RELAY_STAGE unknown\n'
        ;;
    esac
  fi
  false
fi
document_id=$(awk '$1 == "DOCUMENT_ID" { print $2; exit }' "$document_flow_result")
[[ "$document_id" =~ ^[0-9a-fA-F-]{36}$ ]] || exit 1
emit_phase verify-media-probe-flow
verify_media_probe_flow
