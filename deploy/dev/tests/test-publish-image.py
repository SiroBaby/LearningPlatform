#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'publish-image.sh'
DIGEST = 'sha256:' + 'a' * 64
MOCK_DOCKER = '''#!/usr/bin/env python3
import json, os, pathlib, sys
directory = pathlib.Path(os.environ['MOCK_DIR'])
count_file = directory / 'count'
attempt = int(count_file.read_text()) + 1 if count_file.exists() else 1
count_file.write_text(str(attempt))
with (directory / 'arguments').open('a') as arguments:
    arguments.write(json.dumps(sys.argv[1:]) + '\\n')
failures = json.loads(os.environ['MOCK_FAILURES'])
if attempt <= len(failures):
    print(failures[attempt - 1], file=sys.stderr)
    sys.exit(int(os.environ.get('MOCK_STATUS', '1')))
metadata = sys.argv[sys.argv.index('--metadata-file') + 1]
pathlib.Path(metadata).write_text(os.environ['MOCK_METADATA'])
'''


class PublishImageTests(unittest.TestCase):
    def run_publish(self, failures=(), metadata=None, status=1, image=None):
        with tempfile.TemporaryDirectory(prefix='ghcr-publish-test-') as tmp:
            directory = Path(tmp)
            for name, text in (
                ('docker', MOCK_DOCKER),
                ('sleep', '#!/bin/sh\nprintf "%s\\n" "$1" >> "$MOCK_DIR/sleeps"\n'),
            ):
                executable = directory / name
                executable.write_text(text)
                executable.chmod(0o700)
            output = directory / 'output'
            output.touch()
            env = dict(os.environ, PATH=str(directory) + ':' + os.environ['PATH'],
                       BUILD_CONTEXT='app', DOCKERFILE='app/Dockerfile',
                       IMAGE=image or 'ghcr.io/sirobaby/learningplatform-api:sha-' + 'b' * 40,
                       GITHUB_OUTPUT=str(output), RUNNER_TEMP=tmp, MOCK_DIR=tmp,
                       MOCK_FAILURES=json.dumps(failures), MOCK_STATUS=str(status),
                       MOCK_METADATA=metadata if metadata is not None else json.dumps({'containerimage.digest': DIGEST}))
            result = subprocess.run(['bash', str(SCRIPT)], env=env, text=True, capture_output=True)
            attempts = int((directory / 'count').read_text()) if (directory / 'count').exists() else 0
            arguments = [json.loads(line) for line in (directory / 'arguments').read_text().splitlines()] if attempts else []
            sleeps = (directory / 'sleeps').read_text().splitlines() if (directory / 'sleeps').exists() else []
            self.assertEqual(list(directory.glob('ghcr-publish.*')), [], 'private publish files must be cleaned')
            return result, attempts, output.read_text(), arguments, sleeps

    def test_success_outputs_manifest_digest_and_keeps_build_contract(self):
        result, attempts, output, arguments, sleeps = self.run_publish()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((attempts, output, sleeps), (1, 'digest=' + DIGEST + '\n', []))
        self.assertEqual(arguments[0], ['buildx', 'build', 'app', '--file', 'app/Dockerfile',
                         '--platform', 'linux/amd64', '--tag', 'ghcr.io/sirobaby/learningplatform-api:sha-' + 'b' * 40,
                         '--provenance=mode=min,inline-only=true', '--metadata-file', arguments[0][-2], '--push'])

    def test_transient_push_errors_retry_with_same_inputs(self):
        for error in ('429 Too Many Requests', '500 Internal Server Error', '502 Bad Gateway',
                      '503 Service Unavailable', '504 Gateway Timeout', 'connection reset by peer',
                      'i/o timeout', 'TLS handshake timeout', 'unexpected EOF'):
            with self.subTest(error=error):
                result, attempts, output, arguments, sleeps = self.run_publish(
                    ['ERROR: failed to push ghcr.io/sirobaby/learningplatform-api: ' + error] * 2)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((attempts, sleeps), (3, ['10', '20']))
                self.assertTrue(output.startswith('digest=sha256:'))
                self.assertTrue(all(command == arguments[0] for command in arguments))

    def test_exhaustion_retains_failure_and_no_digest(self):
        result, attempts, output, _, sleeps = self.run_publish(
            ['failed to push ghcr.io/sirobaby/learningplatform-api: 503 Service Unavailable'] * 3, status=17)
        self.assertEqual((result.returncode, attempts, output, sleeps), (17, 3, '', ['10', '20']))

    def test_permanent_unknown_and_non_push_errors_fail_immediately(self):
        for error in ('failed to push ghcr.io/sirobaby/learningplatform-api: 401 unauthorized 503',
                      'failed to push ghcr.io/sirobaby/learningplatform-api: 403 forbidden',
                      'failed to push ghcr.io/sirobaby/learningplatform-api: denied',
                      'failed to push ghcr.io/sirobaby/learningplatform-api: x509 certificate expired',
                      'failed to push ghcr.io/sirobaby/learningplatform-api: manifest invalid',
                      'npm ci failed with 503 Service Unavailable',
                      'failed to fetch cache: 503 Service Unavailable',
                      'failed to push another.registry/image: 503 Service Unavailable'):
            with self.subTest(error=error):
                result, attempts, output, _, sleeps = self.run_publish([error], status=9)
                self.assertEqual((result.returncode, attempts, output, sleeps), (9, 1, '', []))
                self.assertNotIn(error, result.stderr, 'raw registry output must stay private')

    def test_timeout_is_not_retried(self):
        result, attempts, output, _, sleeps = self.run_publish(
            ['failed to push ghcr.io/sirobaby/learningplatform-api: i/o timeout'], status=124)
        self.assertEqual((result.returncode, attempts, output, sleeps), (124, 1, '', []))

    def test_invalid_metadata_never_emits_digest_or_retries(self):
        for metadata in ('not json', '{}', '{"containerimage.digest":"latest"}',
                         '{"containerimage.digest":null}', '{"containerimage.digest":"sha256:abc"}'):
            with self.subTest(metadata=metadata):
                result, attempts, output, _, sleeps = self.run_publish(metadata=metadata)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual((attempts, output, sleeps), (1, '', []))

    def test_invalid_image_is_rejected_before_docker(self):
        result, attempts, output, _, sleeps = self.run_publish(image='ghcr.io/sirobaby/learningplatform-api:latest')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((attempts, output, sleeps), (0, '', []))


if __name__ == '__main__':
    unittest.main()
