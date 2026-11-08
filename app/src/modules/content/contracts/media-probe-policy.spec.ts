import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from '@jest/globals';

import { MAX_MEDIA_DURATION_SEC } from './media-probe-policy';

const REPOSITORY_ROOT = join(__dirname, '../../../../..');
const GO_POLICY_PATH = join(REPOSITORY_ROOT, 'worker/internal/mediaprobe/policy.go');
const GO_STT_STITCH_PATH = join(REPOSITORY_ROOT, 'worker/internal/processing/stt_stitch.go');
const WEB_UPLOAD_UTILS_PATH = join(REPOSITORY_ROOT, 'web/src/components/upload/upload-workspace-utils.ts');
const GO_MAX_DURATION_PATTERN = /^\s*maxMediaDurationSec\s*=\s*(\d+)\s*$/m;
const GO_MAX_TRANSCRIBABLE_PATTERN = /^\s*MaxTranscribableDurationSec\s*=\s*(\d+)(?:\.0)?\s*$/m;
const WEB_MAX_DURATION_PATTERN = /MAX_MEDIA_DURATION_SECONDS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/;

describe('media probe duration policy', () => {
  it('keeps the Node MAX_MEDIA_DURATION_SEC equal to the Go maxMediaDurationSec constant', () => {
    const inputGoSource = readFileSync(GO_POLICY_PATH, 'utf8');

    const actualMatch = GO_MAX_DURATION_PATTERN.exec(inputGoSource);

    expect(actualMatch).not.toBeNull();
    expect(MAX_MEDIA_DURATION_SEC).toBe(Number(actualMatch?.[1]));
  });

  it('keeps the Go STT MaxTranscribableDurationSec equal to the Node limit', () => {
    const inputGoSource = readFileSync(GO_STT_STITCH_PATH, 'utf8');

    const actualMatch = GO_MAX_TRANSCRIBABLE_PATTERN.exec(inputGoSource);

    expect(actualMatch).not.toBeNull();
    expect(Number(actualMatch?.[1])).toBe(MAX_MEDIA_DURATION_SEC);
  });

  it('keeps the web MAX_MEDIA_DURATION_SECONDS equal to the Node limit', () => {
    const inputWebSource = readFileSync(WEB_UPLOAD_UTILS_PATH, 'utf8');

    const actualMatch = WEB_MAX_DURATION_PATTERN.exec(inputWebSource);

    expect(actualMatch).not.toBeNull();
    const actualSeconds = actualMatch!.slice(1).reduce((product, factor) => product * Number(factor), 1);
    expect(actualSeconds).toBe(MAX_MEDIA_DURATION_SEC);
  });
});
