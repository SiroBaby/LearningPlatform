import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from '@jest/globals';

describe('S3-compatible runtime dependency', () => {
  it('loads the production object-storage client through the CommonJS runtime', () => {
    expect(typeof S3Client).toBe('function');
  });
});
