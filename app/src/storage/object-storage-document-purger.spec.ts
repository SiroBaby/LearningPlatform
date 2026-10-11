import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from '@jest/globals';

import type { DocumentPurgeStorageConnection } from '../config/configuration.types';
import { DocumentPurgeErrorCode } from '../modules/content/enums/document-purge-error-code.enum';
import { startFakeEgressProxy, startFakeS3Server } from '../test-support/fake-storage-network';
import { classifyPurgeStorageError, createDocumentPurgeS3Client } from './object-storage-document-purger';

const LOOPBACK_HOST = '127.0.0.1';
const UNUSED_PORT = 9;

/** Error the SDK throws when the body was an S3 error document: it carries `Code`. */
function sdkError(code: string, httpStatusCode?: number): Error {
  return Object.assign(nonS3Error(code, httpStatusCode), { Code: code });
}

/** Error the SDK throws for any other response (proxy page, empty body): no `Code`. */
function nonS3Error(name: string, httpStatusCode?: number): Error {
  return Object.assign(new Error('raw provider message must not leak'), {
    name,
    $metadata: httpStatusCode === undefined ? {} : { httpStatusCode },
  });
}

describe('classifyPurgeStorageError', () => {
  it.each([
    [sdkError('NoSuchVersion', 404), 'ALREADY_DELETED'],
    [sdkError('NoSuchKey', 404), 'ALREADY_DELETED'],
    [sdkError('SlowDown', 503), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [sdkError('ServiceUnavailable', 503), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [sdkError('InternalError', 500), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [sdkError('WeirdCode', 502), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [sdkError('WeirdCode', 429), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [nonS3Error('Unknown', 502), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [nonS3Error('TimeoutError'), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [sdkError('AccessDenied', 403), DocumentPurgeErrorCode.ACCESS_DENIED],
    [sdkError('InvalidAccessKeyId', 403), DocumentPurgeErrorCode.ACCESS_DENIED],
    [sdkError('SignatureDoesNotMatch', 403), DocumentPurgeErrorCode.ACCESS_DENIED],
    // No S3 error document (proxy/gateway reply): retried, never final,
    // whatever name the SDK invented. Squid's HTML page yields `Error`.
    [nonS3Error('Error', 403), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [nonS3Error('Unknown', 403), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [nonS3Error('NotFound', 404), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [nonS3Error('Unknown', 400), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [nonS3Error('AccessDenied', 403), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [nonS3Error('NoSuchKey', 404), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [sdkError('NoSuchBucket', 404), DocumentPurgeErrorCode.CONFIGURATION],
    [sdkError('InvalidArgument', 400), DocumentPurgeErrorCode.CONFIGURATION],
    [sdkError('PermanentRedirect', 301), DocumentPurgeErrorCode.CONFIGURATION],
    [sdkError('MalformedXML', 400), DocumentPurgeErrorCode.CONFIGURATION],
    ['not an error', DocumentPurgeErrorCode.STORAGE_TEMPORARY],
  ])('classifies %p as %s', (error, expected) => {
    expect(classifyPurgeStorageError(error)).toBe(expected);
  });
});

describe('classifyPurgeStorageError with the real SDK', () => {
  function connectionFor(overrides: Partial<DocumentPurgeStorageConnection>): DocumentPurgeStorageConnection {
    return {
      accessKey: 'purge-test',
      egressProxyUrl: undefined,
      endpoint: LOOPBACK_HOST,
      port: UNUSED_PORT,
      region: 'us-east-1',
      requestTimeoutMs: 5_000,
      secretKey: 'purge-test-secret',
      useSSL: false,
      ...overrides,
    };
  }

  async function sendDelete(connection: DocumentPurgeStorageConnection): Promise<unknown> {
    const client = createDocumentPurgeS3Client(connection);
    try {
      await client.send(new DeleteObjectCommand({ Bucket: 'purge-media', Key: 'media/a/b.mp4', VersionId: 'v1' }));
      throw new Error('expected the request to fail');
    } catch (error) {
      return error;
    } finally {
      client.destroy();
    }
  }

  it('retries a Squid CONNECT refusal: a plain Error with no S3 Code', async () => {
    const proxy = await startFakeEgressProxy({ forward: false });
    try {
      const inputError = await sendDelete(connectionFor({ egressProxyUrl: proxy.url }));

      expect(inputError).toMatchObject({ $metadata: { httpStatusCode: 403 }, name: 'Error' });
      expect(inputError).not.toHaveProperty('Code');
      expect(classifyPurgeStorageError(inputError)).toBe(DocumentPurgeErrorCode.STORAGE_TEMPORARY);
    } finally {
      await proxy.stop();
    }
  });

  it('dead-letters AccessDenied only when S3 itself sent the error document', async () => {
    const fakeS3 = await startFakeS3Server({ code: 'AccessDenied', status: 403 });
    try {
      const inputError = await sendDelete(connectionFor({ port: fakeS3.port }));

      expect(inputError).toMatchObject({ Code: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
      expect(classifyPurgeStorageError(inputError)).toBe(DocumentPurgeErrorCode.ACCESS_DENIED);
    } finally {
      await fakeS3.stop();
    }
  });
});
