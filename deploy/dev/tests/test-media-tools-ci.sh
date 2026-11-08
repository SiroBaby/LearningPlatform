#!/usr/bin/env bash
# CI media toolchain and PR web workflow contract:
# - no workflow installs ffmpeg from apt (slow mirror, unpinned version);
# - every ffmpeg/ffprobe CI job uses the pinned, checksummed image artifact;
# - the installer rejects a wrong checksum or version before exposing binaries;
# - web and deploy/dev changes run their quality gates on pull requests.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT_DIR
readonly INSTALLER="${ROOT_DIR}/worker/scripts/install-media-tools.sh"
readonly FIXTURE_VERSION='1.2.3-4-gabcdef'
readonly FIXTURE_BUILD_VERSION='1.2.3-4-gabcdef-20260101'
readonly FIXTURE_ASSET="ffmpeg-n${FIXTURE_VERSION}-linux64-gpl-8.1.tar.xz"

fail() {
  printf 'media tools CI test failed: %s\n' "$*" >&2
  exit 1
}

assert_workflows_do_not_use_apt_ffmpeg() {
  if grep -En 'apt-get install.*ffmpeg|apt install.*ffmpeg' "${ROOT_DIR}"/.github/workflows/*.yml; then
    fail 'workflows must install ffmpeg/ffprobe from the pinned artifact, not apt'
  fi
}

assert_production_pin() {
  local dockerfile="${ROOT_DIR}/worker/Dockerfile"
  grep -Eq '^ARG FFPROBE_SHA256=[0-9a-f]{64}$' "${dockerfile}" || fail 'worker/Dockerfile must pin a literal FFPROBE_SHA256'
  grep -Eq '^ARG FFPROBE_BUILD_VERSION=[^$]+$' "${dockerfile}" || fail 'worker/Dockerfile must pin a literal FFPROBE_BUILD_VERSION'
  grep -q 'sha256sum --check --status' "${INSTALLER}" || fail 'installer must verify the archive checksum'
  local release
  release="$(sed -n 's/^ARG FFPROBE_RELEASE=\(.*\)$/\1/p' "${dockerfile}")"
  is_month_end_release "${release}" || fail "FFPROBE_RELEASE '${release}' must be a month-end BtbN build (daily autobuilds are deleted after ~2 weeks)"
}

# True when the argument is autobuild-YYYY-MM-DD-HH-MM and DD is the last day of that month.
is_month_end_release() {
  local release="$1" year month day hour minute last_day
  [[ "${release}" =~ ^autobuild-([0-9]{4})-([0-9]{2})-([0-9]{2})-([0-9]{2})-([0-9]{2})$ ]] || return 1
  year=$((10#${BASH_REMATCH[1]})) month=$((10#${BASH_REMATCH[2]})) day=$((10#${BASH_REMATCH[3]}))
  hour=$((10#${BASH_REMATCH[4]})) minute=$((10#${BASH_REMATCH[5]}))
  ((month >= 1 && month <= 12 && hour <= 23 && minute <= 59)) || return 1
  case "${month}" in
    4 | 6 | 9 | 11) last_day=30 ;;
    2)
      if ((year % 400 == 0 || (year % 4 == 0 && year % 100 != 0))); then last_day=29; else last_day=28; fi
      ;;
    *) last_day=31 ;;
  esac
  ((day == last_day))
}

assert_month_end_release_contract() {
  local valid invalid
  for valid in autobuild-2026-10-31-12-59 autobuild-2026-09-30-13-08 autobuild-2028-02-29-00-00 autobuild-2026-02-28-23-59 autobuild-2000-02-29-01-01; do
    is_month_end_release "${valid}" || fail "month-end check rejected valid release ${valid}"
  done
  for invalid in autobuild-2026-10-09-14-16 autobuild-2026-02-29-12-00 autobuild-2028-02-28-12-00 autobuild-1900-02-29-12-00 \
    autobuild-2026-04-31-12-00 autobuild-2026-13-31-12-00 autobuild-2026-10-31-24-00 autobuild-fixture latest ''; do
    if is_month_end_release "${invalid}"; then fail "month-end check accepted invalid release '${invalid}'"; fi
  done
}

write_fake_tool() {
  local path="$1" name="$2" version="$3"
  printf '#!/bin/sh\nprintf "%%s version n%%s Copyright\\n" %s %s\n' "${name}" "${version}" > "${path}"
  chmod +x "${path}"
}

# Builds an archive with the BtbN layout and a Dockerfile pinning its checksum.
make_fixture() {
  local dir="$1" reported_version="$2" pinned_sha="${3:-}"
  local top="${dir}/src/${FIXTURE_ASSET%.tar.xz}/bin"
  mkdir -p "${top}"
  write_fake_tool "${top}/ffmpeg" ffmpeg "${reported_version}"
  write_fake_tool "${top}/ffprobe" ffprobe "${reported_version}"
  tar --create --xz --file "${dir}/${FIXTURE_ASSET}" --directory "${dir}/src" "${FIXTURE_ASSET%.tar.xz}"
  if [[ -z "${pinned_sha}" ]]; then
    pinned_sha="$(sha256sum "${dir}/${FIXTURE_ASSET}" | awk '{ print $1 }')"
  fi
  cat > "${dir}/Dockerfile" <<DOCKERFILE
ARG FFPROBE_VERSION=${FIXTURE_VERSION}
ARG FFPROBE_BUILD_VERSION=${FIXTURE_BUILD_VERSION}
ARG FFPROBE_RELEASE=autobuild-fixture
ARG FFPROBE_ASSET=${FIXTURE_ASSET}
ARG FFPROBE_SHA256=${pinned_sha}
DOCKERFILE
}

run_installer() {
  local dir="$1"
  MEDIA_TOOLS_DOCKERFILE="${dir}/Dockerfile" MEDIA_TOOLS_ARCHIVE="${dir}/${FIXTURE_ASSET}" \
    MEDIA_TOOLS_INSTALL_DIR="${dir}/bin" GITHUB_PATH="${dir}/github-path" \
    bash "${INSTALLER}" >"${dir}/out.log" 2>&1
}

assert_installer_contract() {
  local temp_dir="$1"
  mkdir -p "${temp_dir}/ok" "${temp_dir}/checksum" "${temp_dir}/version"
  make_fixture "${temp_dir}/ok" "${FIXTURE_BUILD_VERSION}"
  run_installer "${temp_dir}/ok" || fail "installer rejected a valid archive: $(cat "${temp_dir}/ok/out.log")"
  [[ "$(cat "${temp_dir}/ok/github-path")" == "${temp_dir}/ok/bin" ]] || fail 'installer must add the install dir to GITHUB_PATH'
  [[ -x "${temp_dir}/ok/bin/ffmpeg" && -x "${temp_dir}/ok/bin/ffprobe" ]] || fail 'installer must install ffmpeg and ffprobe'
  make_fixture "${temp_dir}/checksum" "${FIXTURE_BUILD_VERSION}" "$(printf '0%.0s' {1..64})"
  if run_installer "${temp_dir}/checksum"; then
    fail 'installer accepted an archive with a mismatched checksum'
  fi
  grep -q 'checksum mismatch' "${temp_dir}/checksum/out.log" || fail 'checksum failure must be explicit'
  [[ ! -e "${temp_dir}/checksum/bin/ffprobe" && ! -e "${temp_dir}/checksum/github-path" ]] || fail 'checksum failure must not install binaries'
  make_fixture "${temp_dir}/version" '9.9.9-other'
  if run_installer "${temp_dir}/version"; then
    fail 'installer accepted binaries reporting another version'
  fi
  [[ ! -e "${temp_dir}/version/github-path" ]] || fail 'version failure must not expose binaries on PATH'
}

assert_workflow_contract() {
  ruby - "${ROOT_DIR}" <<'RUBY'
require 'yaml'
root = ARGV.fetch(0)
load = ->(name) { YAML.safe_load(File.read(File.join(root, '.github/workflows', name)), aliases: true) }
failures = []
check = ->(ok, message) { failures << message unless ok }
installers = {
  'backend-ci.yml quality' => [load.call('backend-ci.yml').dig('jobs', 'quality', 'steps'), 'bash ../worker/scripts/install-media-tools.sh'],
  'worker-ci.yml quality' => [load.call('worker-ci.yml').dig('jobs', 'quality', 'steps'), 'bash scripts/install-media-tools.sh'],
  'deploy-dev.yml worker-quality' => [load.call('deploy-dev.yml').dig('jobs', 'worker-quality', 'steps'), 'bash scripts/install-media-tools.sh']
}
installers.each do |label, (steps, command)|
  check.call(steps.any? { |step| step['run'] == command }, "#{label} must install media tools with #{command}")
end
web = load.call('web-quality.yml')
triggers = web['on'] || web[true]
check.call(triggers.dig('pull_request', 'paths') == ['web/**', 'deploy/dev/**', 'app/src/modules/ai/contracts/document-processing-result.ts', '.github/workflows/web-quality.yml'],
           'web-quality.yml must run on pull requests that change web/**, deploy/dev/** or the backend failure-code contract')
check.call(triggers.key?('workflow_call'), 'web-quality.yml must stay reusable by deploy-dev.yml')
web_steps = web.dig('jobs', 'quality', 'steps')
web_commands = web_steps.map { |step| step['run'] }.compact
expected_web = ['npm ci --no-audit --no-fund', 'timeout 180s node ../deploy/dev/audit-high.js', 'npm run lint',
                'npm run build', 'npx tsc --noEmit', 'npm run test:runtime']
check.call(web_commands == expected_web, "web quality commands drifted: #{web_commands}")
check.call(web.dig('jobs', 'quality', 'defaults', 'run', 'working-directory') == 'web', 'web quality must run inside web/')
frontend = load.call('deploy-dev.yml').dig('jobs', 'frontend-quality')
check.call(frontend['uses'] == './.github/workflows/web-quality.yml' && frontend['permissions'] == { 'contents' => 'read' },
           'deploy-dev frontend-quality must reuse web-quality.yml with read-only contents')
deploy_ci = load.call('deploy-workflow-ci.yml')
deploy_triggers = deploy_ci['on'] || deploy_ci[true]
%w[deploy/dev/** worker/scripts/install-media-tools.sh worker/Dockerfile].each do |path|
  check.call(deploy_triggers.dig('pull_request', 'paths').include?(path), "deploy-workflow-ci.yml must run on pull requests changing #{path}")
end
suite = deploy_ci.dig('jobs', 'contract', 'steps').find { |step| step['name'] == 'Run remaining deploy/dev regression tests' }
check.call(!suite.nil? && suite['run'].lines.map(&:strip).include?('deploy/dev/tests/test-media-tools-ci.sh \\'),
           'deploy-workflow-ci.yml must run this media tools contract')
# Infra contracts (validate.sh, including the media-probe contract playbook) must gate pull requests, not only the
# post-merge infra-quality job, and must run with ansible-playbook on PATH so the playbook contracts are not skipped.
%w[pull_request push].each do |event|
  check.call(deploy_triggers.dig(event, 'paths').include?('infra/**'), "deploy-workflow-ci.yml must run on #{event} changing infra/**")
end
infra_steps = deploy_ci.dig('jobs', 'infra-contract', 'steps') || []
infra_commands = infra_steps.map { |step| step['run'].to_s }
validate_step = infra_steps.find { |step| step['name'] == 'Validate infrastructure source contract' }
validate_lines = validate_step ? validate_step['run'].lines.map(&:strip) : []
check.call(validate_lines.include?('bash infra/scripts/validate.sh | tee "$RUNNER_TEMP/validate.log"') && validate_lines.include?('set -o pipefail'),
           'deploy-workflow-ci.yml infra-contract must run infra/scripts/validate.sh with pipefail and capture its log')
check.call(validate_lines.include?('command -v ansible-playbook') && validate_lines.include?("! grep -q '^SKIP:' \"$RUNNER_TEMP/validate.log\""),
           'deploy-workflow-ci.yml infra-contract must fail when ansible-playbook is missing or validate.sh skipped a contract')
check.call(deploy_ci.dig('jobs', 'infra-contract', 'if').to_s.include?('pull_request') && deploy_ci.dig('concurrency', 'cancel-in-progress') == true,
           'deploy-workflow-ci.yml must cancel superseded runs and avoid duplicate infra-contract runs on branch pushes')
install = infra_steps.find { |step| step['name'] == 'Install pinned Ansible tooling' }
check.call(!install.nil? && install['run'].include?("ansible-core==2.21.2") && install['run'].include?('>> "$GITHUB_PATH"'),
           'deploy-workflow-ci.yml infra-contract must install pinned ansible-core and put it on PATH before validate.sh')
check.call(infra_steps.index(install) < infra_steps.index { |step| step['run'].to_s.include?('validate.sh') },
           'deploy-workflow-ci.yml infra-contract must install Ansible before validate.sh')
%w[web-quality.yml deploy-workflow-ci.yml].each do |name|
  uses = load.call(name).fetch('jobs').values.flat_map { |job| job.fetch('steps', []) }.map { |step| step['uses'] }.compact
  check.call(uses.all? { |ref| ref.match?(/@[0-9a-f]{40}\z/) }, "#{name} actions must be pinned to immutable SHAs")
end
abort(failures.map { |failure| "media tools CI test failed: #{failure}" }.join("\n")) unless failures.empty?
RUBY
}

main() {
  local temp_dir
  temp_dir="$(mktemp -d)"
  # shellcheck disable=SC2064 # Expand now: temp_dir is local to main.
  trap "rm -rf -- '${temp_dir}'" EXIT
  assert_workflows_do_not_use_apt_ffmpeg
  assert_month_end_release_contract
  assert_production_pin
  assert_installer_contract "${temp_dir}"
  assert_workflow_contract
  printf '%s\n' 'media tools CI contract passed'
}

main "$@"
