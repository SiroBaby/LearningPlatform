import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from '@jest/globals';

import { MAX_MEDIA_DURATION_SEC } from './media-probe-policy';

const GO_POLICY_PATH = join(__dirname, '../../../../../worker/internal/mediaprobe/policy.go');
const GO_MAX_DURATION_PATTERN = /^\s*maxMediaDurationSec\s*=\s*(\d+)\s*$/m;

describe('media probe duration policy', () => {
  it('keeps the Node MAX_MEDIA_DURATION_SEC equal to the Go maxMediaDurationSec constant', () => {
    const inputGoSource = readFileSync(GO_POLICY_PATH, 'utf8');

    const actualMatch = GO_MAX_DURATION_PATTERN.exec(inputGoSource);

    expect(actualMatch).not.toBeNull();
    expect(MAX_MEDIA_DURATION_SEC).toBe(Number(actualMatch?.[1]));
  });
});
