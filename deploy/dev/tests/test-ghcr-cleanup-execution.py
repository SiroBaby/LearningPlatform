#!/usr/bin/env python3
"""Exercise selector/deleter and the production workflow without network access."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
SELECTOR = ROOT / 'deploy/dev/select-ghcr-versions.py'
DELETER = ROOT / 'deploy/dev/delete-ghcr-versions.sh'
PACKAGES = ('learningplatform-api', 'learningplatform-web')
DIGEST = 'sha256:' + 'a' * 64
IMAGE = 'ghcr.io/sirobaby/learningplatform-api@' + DIGEST


def workflow():
    result = subprocess.run(['ruby', '-ryaml', '-rjson', '-e',
                             'puts JSON.generate(YAML.safe_load(File.read(ARGV[0]), aliases: true))',
                             str(ROOT / '.github/workflows/cleanup-ghcr.yml')],
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


WORKFLOW = workflow()
STEPS = {step.get('name'): step for step in WORKFLOW['jobs']['cleanup']['steps']}


class CleanupExecutionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ghcr-cleanup-execution-')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.bin = self.directory / 'bin'
        self.bin.mkdir()
        self.log = self.directory / 'curl-log'
        self.env = dict(os.environ, PATH=str(self.bin) + ':' + os.environ['PATH'],
                        RUNNER_TEMP=str(self.directory), CANDIDATE_DIR=str(self.directory),
                        EVENT_NAME='schedule', OWNER='SiroBaby', GITHUB_TOKEN='fixture-token',
                        CURL_LOG=str(self.log), MOCK_DIR=str(self.directory),
                        VPS_HOST='fixture.example.test', VPS_USER='fixture',
                        MOCK_IMAGE=IMAGE)
        self.env.pop('BASH_ENV', None)
        for package in PACKAGES:
            (self.directory / (package + '-delete-ids')).write_text('')
        self.executable('curl', '''#!/usr/bin/env python3
import json, os, pathlib, sys
with open(os.environ['CURL_LOG'], 'a') as log:
    log.write(json.dumps(sys.argv[1:]) + '\\n')
if '-X' in sys.argv:
    sys.exit(int(os.environ.get('MOCK_DELETE_STATUS', '0')))
url = sys.argv[-1]
if 'per_page=100' not in url or '/users/SiroBaby/packages/container/' not in url:
    sys.exit(31)
package = next(name for name in ('learningplatform-api','learningplatform-web') if name in url)
print((pathlib.Path(os.environ['MOCK_DIR']) / (package + '-response.json')).read_text())
''')
        self.executable('ssh', '''#!/usr/bin/env python3
import os, subprocess, sys
required = ('-n', 'BatchMode=yes', 'ConnectTimeout=15', 'ConnectionAttempts=1',
            'ServerAliveInterval=5', 'ServerAliveCountMax=2', 'StrictHostKeyChecking=yes')
if any(option not in sys.argv for option in required):
    sys.exit(32)
if os.environ.get('MOCK_SSH_FAILURE') == 'true' and 'replicasets' in sys.argv[-1]:
    print('private remote diagnostic must not leak', file=sys.stderr)
    sys.exit(255)
sys.exit(subprocess.run(['bash', '--noprofile', '--norc', '-ceu', sys.argv[-1]]).returncode)
''')
        self.executable('sudo', '#!/bin/sh\n[ "$1" = -n ] && [ "$2" = k3s ] || exit 34\nshift\nexec "$@"\n')
        self.executable('k3s', '''#!/usr/bin/env python3
import os, sys
expected = ['kubectl','get',sys.argv[3],'--namespace','learning-platform-dev','-o',
            r'jsonpath={range .items[*].spec.template.spec.containers[*]}{.image}{"\\n"}{end}']
if sys.argv[1:] != expected or sys.argv[3] not in ('deployments','replicasets'):
    print(repr(sys.argv[1:]), file=sys.stderr)
    sys.exit(33)
print(os.environ['MOCK_IMAGE'])
''')

    def executable(self, name, source):
        path = self.bin / name
        path.write_text(source)
        path.chmod(0o700)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def run_delete(self, **overrides):
        return subprocess.run(['bash', str(DELETER)], env=dict(self.env, **overrides),
                              text=True, capture_output=True)

    def run_step(self, name):
        return subprocess.run(['bash', '--noprofile', '--norc', '-e', '-c', STEPS[name]['run']], env=self.env,
                              text=True, capture_output=True, cwd=ROOT)

    def select(self, versions, package=PACKAGES[0]):
        path = self.directory / (package + '-versions.json')
        path.write_text(json.dumps(versions))
        protected = self.directory / 'protected-digests'
        protected.write_text(DIGEST + '\n')
        result = subprocess.run(['python3', str(SELECTOR), '--versions', str(path),
                                 '--protected-digests', str(protected), '--as-of', '2026-10-10T00:00:00Z'],
                                capture_output=True, check=True)
        (self.directory / (package + '-delete-ids')).write_bytes(result.stdout)
        return result.stdout

    @staticmethod
    def versions(count, protected=False):
        return [{'id': index, 'name': DIGEST if protected else 'sha256:' + f'{index:064x}',
                 'created_at': '2026-01-01T00:00:00Z',
                 'metadata': {'container': {'tags': ['sha-' + f'{index:040x}']}}}
                for index in range(1, count + 1)]

    def test_no_candidates_are_zero_bytes_and_schedule_is_noop(self):
        for versions in ([], self.versions(5), self.versions(15, protected=True)):
            with self.subTest(versions=len(versions)):
                self.assertEqual(self.select(versions), b'')
                result = self.run_delete()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('nothing to delete', result.stdout)
                self.assertEqual(self.calls(), [])

    def test_empty_one_package_does_not_block_exact_other_package(self):
        self.assertEqual(self.select(self.versions(11), PACKAGES[1]), b'1\n')
        result = self.run_delete()
        self.assertEqual(result.returncode, 0, result.stderr)
        call, = self.calls()
        self.assertEqual(call[-1], 'https://api.github.com/users/SiroBaby/packages/container/learningplatform-web/versions/1')
        for option in ('--retry', '--retry-max-time', '--connect-timeout', '--max-time'):
            self.assertIn(option, call)
        self.assertNotIn('--retry-all-errors', call)

    def test_all_packages_preflight_before_any_delete(self):
        (self.directory / (PACKAGES[0] + '-delete-ids')).write_text('101\n')
        path = self.directory / (PACKAGES[1] + '-delete-ids')
        for invalid in ('\n', '202\n\n', '202\n../bad\n', '0\n', '-2\n', '202 \n', '202\n202\n'):
            with self.subTest(invalid=repr(invalid)):
                path.write_text(invalid)
                self.assertNotEqual(self.run_delete().returncode, 0)
                self.assertEqual(self.calls(), [])

    def test_missing_file_or_symlink_preflight_blocks_all_deletion(self):
        (self.directory / (PACKAGES[0] + '-delete-ids')).write_text('101\n')
        path = self.directory / (PACKAGES[1] + '-delete-ids')
        path.unlink()
        self.assertNotEqual(self.run_delete().returncode, 0)
        path.symlink_to(self.directory / (PACKAGES[0] + '-delete-ids'))
        self.assertNotEqual(self.run_delete().returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_unknown_event_or_owner_cannot_delete(self):
        (self.directory / (PACKAGES[0] + '-delete-ids')).write_text('101\n')
        for overrides in ({'EVENT_NAME': 'push'}, {'OWNER': '../another-owner'}):
            with self.subTest(overrides=overrides):
                self.assertNotEqual(self.run_delete(**overrides).returncode, 0)
                self.assertEqual(self.calls(), [])

    def test_dry_run_only_prints_allowlisted_candidate_files(self):
        (self.directory / (PACKAGES[0] + '-delete-ids')).write_text('101')
        (self.directory / 'unmanaged-delete-ids').write_text('do-not-read\n')
        result = self.run_delete(EVENT_NAME='workflow_dispatch', CONFIRMATION='')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'manual run is dry-run; type DELETE in confirmation to delete\nlearningplatform-api/101\n')
        self.assertEqual(self.calls(), [])

    def test_manual_confirmed_deletion_and_request_failure(self):
        (self.directory / (PACKAGES[0] + '-delete-ids')).write_text('101\n102\n')
        result = self.run_delete(EVENT_NAME='workflow_dispatch', CONFIRMATION='DELETE', MOCK_DELETE_STATUS='22')
        self.assertEqual(result.returncode, 22)
        self.assertEqual(len(self.calls()), 1, 'do not continue deletions after request failure')

    def test_production_collection_executes_exact_remote_jsonpath(self):
        result = self.run_step('Collect protected K3s image digests')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.directory / 'protected-digests').read_text(), DIGEST + '\n')
        self.assertFalse(list(self.directory.glob('protected-*.tmp')))

    def test_collection_failure_or_mutable_image_publishes_no_evidence(self):
        for overrides in ({'MOCK_SSH_FAILURE': 'true'},
                          {'MOCK_IMAGE': 'ghcr.io/sirobaby/learningplatform-api:latest'},
                          {'MOCK_IMAGE': 'ghcr.io/sirobaby/learningplatform-web@sha256:bad'},
                          {'MOCK_IMAGE': 'another.registry/image:latest'}):
            with self.subTest(overrides=overrides):
                (self.directory / 'protected-digests').write_text('stale-evidence\n')
                (self.directory / 'protected-images').write_text('stale-evidence\n')
                self.env.update(overrides)
                result = self.run_step('Collect protected K3s image digests')
                self.assertNotEqual(result.returncode, 0)
                if 'MOCK_SSH_FAILURE' in overrides:
                    self.assertIn('transport failed for replicasets (rc=255)', result.stderr)
                    self.assertNotIn('private remote diagnostic', result.stderr)
                elif overrides['MOCK_IMAGE'].startswith('another.registry/'):
                    self.assertIn('no protected K3s digests were discovered; refusing cleanup', result.stderr)
                else:
                    self.assertIn('managed K3s image is not an immutable digest', result.stderr)
                self.assertFalse((self.directory / 'protected-digests').exists())
                self.assertFalse((self.directory / 'protected-images').exists())
                self.assertFalse(list(self.directory.glob('protected-*.tmp')))
                self.env.pop('MOCK_SSH_FAILURE', None)
                self.env['MOCK_IMAGE'] = IMAGE

    def test_collection_rejects_invalid_ssh_target(self):
        for host, user in (('', 'fixture'), ('fixture.example.test', ''),
                           ('fixture;exit', 'fixture'), ('fixture.example.test', '-unsafe')):
            with self.subTest(host=host, user=user):
                self.env.update(VPS_HOST=host, VPS_USER=user)
                result = self.run_step('Collect protected K3s image digests')
                self.assertNotEqual(result.returncode, 0)

    def test_workflow_empty_candidates_to_delete_pipeline(self):
        (self.directory / 'protected-digests').write_text(DIGEST + '\n')
        for package in PACKAGES:
            (self.directory / (package + '-response.json')).write_text('[]')
        listed = self.run_step('List and select eligible versions')
        self.assertEqual(listed.returncode, 0, listed.stderr)
        for package in PACKAGES:
            self.assertEqual((self.directory / (package + '-delete-ids')).read_bytes(), b'')
        deleted = self.run_step('Delete selected version IDs')
        self.assertEqual(deleted.returncode, 0, deleted.stderr)
        self.assertFalse(any('-X' in call for call in self.calls()))
        self.assertEqual(STEPS['List and select eligible versions']['env']['OWNER'],
                         STEPS['Delete selected version IDs']['env']['OWNER'])

    def test_workflow_real_candidates_keep_exact_owner_and_package(self):
        (self.directory / 'protected-digests').write_text(DIGEST + '\n')
        for package in PACKAGES:
            (self.directory / (package + '-response.json')).write_text(json.dumps(self.versions(11)))
        listed = self.run_step('List and select eligible versions')
        self.assertEqual(listed.returncode, 0, listed.stderr)
        deleted = self.run_step('Delete selected version IDs')
        self.assertEqual(deleted.returncode, 0, deleted.stderr)
        deletes = [call for call in self.calls() if '-X' in call]
        self.assertEqual([call[-1] for call in deletes],
                         [f'https://api.github.com/users/SiroBaby/packages/container/{package}/versions/1'
                          for package in PACKAGES])


if __name__ == '__main__':
    unittest.main()
