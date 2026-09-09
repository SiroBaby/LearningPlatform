import { describe, expect, it, jest } from '@jest/globals';

import { ObjectStorageVerifier } from './object-storage-verifier';

describe('ObjectStorageVerifier', () => {
  it.each([
    ['AUDIO', 'media/owner/lecture.mp3'],
    ['VIDEO', 'media/owner/lecture.mp4'],
  ])('checks the physical media bucket for %s and defers media validation', async (documentType, objectKey) => {
    const storage = {
      readHead: jest.fn<(key: string, bytes: number, bucket: 'documents' | 'media') => Promise<Buffer>>(),
      statObject: jest.fn<(key: string, bucket: 'documents' | 'media') => Promise<{ size: number; versionId?: string }>>()
        .mockResolvedValue({ size: 1024, versionId: 'version-1' }),
    };
    const verifier = new ObjectStorageVerifier(storage as never);

    await expect(verifier.verify(objectKey, documentType, 'media')).resolves.toEqual({
      contentValidation: 'DEFERRED',
      exists: true,
      sizeBytes: 1024,
      versionId: 'version-1',
    });
    expect(storage.statObject).toHaveBeenCalledWith(objectKey, 'media');
    expect(storage.readHead).not.toHaveBeenCalled();
  });

  it('keeps magic-byte validation for document objects', async () => {
    const storage = {
      readHead: jest.fn<(key: string, bytes: number, bucket: 'documents' | 'media') => Promise<Buffer>>()
        .mockResolvedValue(Buffer.from('%PDF-1.7')),
      statObject: jest.fn<(key: string, bucket: 'documents' | 'media') => Promise<{ size: number; versionId?: string }>>()
        .mockResolvedValue({ size: 1024, versionId: 'version-1' }),
    };
    const verifier = new ObjectStorageVerifier(storage as never);

    await expect(verifier.verify('owner/lesson.pdf', 'PDF', 'documents')).resolves.toEqual({
      contentValidation: 'VALID',
      exists: true,
      sizeBytes: 1024,
      versionId: 'version-1',
    });
    expect(storage.statObject).toHaveBeenCalledWith('owner/lesson.pdf', 'documents');
    expect(storage.readHead).toHaveBeenCalledWith('owner/lesson.pdf', 4096, 'documents');
  });

  it('returns an invalid result when the object is unavailable', async () => {
    const storage = {
      readHead: jest.fn<(key: string, bytes: number, bucket: 'documents' | 'media') => Promise<Buffer>>(),
      statObject: jest.fn<(key: string, bucket: 'documents' | 'media') => Promise<{ size: number; versionId?: string }>>()
        .mockRejectedValue(new Error('not found')),
    };
    const verifier = new ObjectStorageVerifier(storage as never);

    await expect(verifier.verify('media/owner/missing.mp4', 'VIDEO', 'media')).resolves.toEqual({
      contentValidation: 'INVALID',
      exists: false,
      sizeBytes: 0,
    });
  });
});
