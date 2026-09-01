import { describe, expect, it } from '@jest/globals';
import { Client as MinioClient } from 'minio';

describe('MinIO runtime dependency compatibility', () => {
  it('loads MinIO through the Jest CommonJS runtime', () => {
    expect(typeof MinioClient).toBe('function');
  });
});
