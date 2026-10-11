import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';

import type { ApplicationConfigService } from '../config/application-config.service';
import { DocumentPurgeStorageError } from '../modules/content/contracts/document-purge-storage.port';
import type { DocumentPurgeService } from '../modules/content/document-purge.service';
import { DocumentPurgeErrorCode } from '../modules/content/enums/document-purge-error-code.enum';
import { DocumentPurgeRunner } from './document-purge-runner.service';

function runnerFailingPreflightWith(error: unknown): DocumentPurgeRunner {
  const purge = {
    assertMediaBucketVersioned: jest.fn(async (): Promise<void> => {
      throw error;
    }),
  } as unknown as DocumentPurgeService;
  return new DocumentPurgeRunner({} as ApplicationConfigService, purge);
}

describe('DocumentPurgeRunner preflight', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    [new DocumentPurgeStorageError(DocumentPurgeErrorCode.MEDIA_BUCKET_NOT_VERSIONED), 'PURGE_MEDIA_BUCKET_NOT_VERSIONED'],
    [new DocumentPurgeStorageError(DocumentPurgeErrorCode.ACCESS_DENIED), 'PURGE_ACCESS_DENIED'],
    [new DocumentPurgeStorageError(DocumentPurgeErrorCode.STORAGE_TEMPORARY), 'PURGE_STORAGE_TEMPORARY'],
    [new Error('raw secret-bearing message s3://bucket/key'), 'PURGE_PREFLIGHT_UNCLASSIFIED'],
  ])('logs a stable reason code for %p without raw error details', async (error, expectedErrorCode) => {
    const logger = jest.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined);

    await expect(runnerFailingPreflightWith(error).onModuleInit()).rejects.toBe(error);

    expect(logger.mock.calls).toEqual([[{
      errorCode: expectedErrorCode,
      event: 'document.purge.preflight.failed',
      runtime: 'document-purge',
    }]]);
  });
});
