import { describe, expect, it } from '@jest/globals';

import { DocumentPurgeErrorCode } from '../modules/content/enums/document-purge-error-code.enum';
import { classifyPurgeStorageError } from './object-storage-document-purger';

function sdkError(name: string, httpStatusCode?: number): Error {
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
    [sdkError('Unknown', 502), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [sdkError('Unknown', 429), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [sdkError('TimeoutError'), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }), DocumentPurgeErrorCode.STORAGE_TEMPORARY],
    [sdkError('AccessDenied', 403), DocumentPurgeErrorCode.ACCESS_DENIED],
    [sdkError('InvalidAccessKeyId', 403), DocumentPurgeErrorCode.ACCESS_DENIED],
    [sdkError('SignatureDoesNotMatch', 403), DocumentPurgeErrorCode.ACCESS_DENIED],
    [sdkError('Unknown', 403), DocumentPurgeErrorCode.ACCESS_DENIED],
    [sdkError('NoSuchBucket', 404), DocumentPurgeErrorCode.CONFIGURATION],
    [sdkError('InvalidArgument', 400), DocumentPurgeErrorCode.CONFIGURATION],
    [sdkError('PermanentRedirect', 301), DocumentPurgeErrorCode.CONFIGURATION],
    [sdkError('Unknown', 400), DocumentPurgeErrorCode.CONFIGURATION],
    ['not an error', DocumentPurgeErrorCode.STORAGE_TEMPORARY],
  ])('classifies %p as %s', (error, expected) => {
    expect(classifyPurgeStorageError(error)).toBe(expected);
  });
});
