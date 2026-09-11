import { describe, expect, it, jest } from '@jest/globals';

import type { ModelCatalog } from '../ai/contracts/model-selection.contracts';
import { MAX_MP4_SIZE_BYTES } from './contracts/document-upload-policy';
import { ContentService } from './content.service';
import { DocumentType } from './enums/document-type.enum';

describe('ContentService.createUploadUrl', () => {
  it('uses the media namespace for media uploads', async () => {
    const repository = {
      createUploaded: jest.fn<(...args: unknown[]) => Promise<{ id: string }>>().mockResolvedValue({ id: 'document-id' }),
    };
    const storage = {
      createPresignedPostUrl: jest.fn<(...args: unknown[]) => Promise<{
        expirySec: number;
        formFields: Record<string, string>;
        url: string;
      }>>().mockResolvedValue({
        expirySec: 300,
        formFields: { key: 'owner/video.mp4' },
        url: 'https://storage.example/upload',
      }),
      getBucketName: jest.fn<(bucket?: 'documents' | 'media') => string>()
        .mockImplementation((bucket = 'documents') => bucket),
    };
    const catalog: ModelCatalog = {
      listForOwner: async () => [{ id: 'plan-model', kind: 'PLAN', label: 'Plan model' }],
      resolvePlan: async () => ({
        creditPerInputToken: 1,
        creditPerOutputToken: 1,
        id: 'plan-model',
        model: 'model',
        planIds: ['free'],
      }),
    };
    const service = new ContentService(
      repository as never,
      storage as never,
      null as never,
      null as never,
      catalog,
      { storage: { mediaEnabled: true } } as never,
    );

    await service.createUploadUrl('owner-id', {
      originalName: 'lecture.mp4',
      sizeBytes: 1024,
      type: DocumentType.VIDEO,
      selection: { customModelConfigId: null, kind: 'PLAN', platformModelId: 'plan-model' },
    });

    expect(storage.createPresignedPostUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^media\/owner-id\/.+\.mp4$/u),
      'video/mp4',
      1024,
      'media',
    );
    expect(storage.getBucketName).toHaveBeenCalledWith('media');
  });

  it('keeps document uploads in the existing owner namespace', async () => {
    const repository = {
      createUploaded: jest.fn<(...args: unknown[]) => Promise<{ id: string }>>().mockResolvedValue({ id: 'document-id' }),
    };
    const storage = {
      createPresignedPostUrl: jest.fn<(...args: unknown[]) => Promise<{
        expirySec: number;
        formFields: Record<string, string>;
        url: string;
      }>>().mockResolvedValue({
        expirySec: 300,
        formFields: { key: 'owner/document.pdf' },
        url: 'https://storage.example/upload',
      }),
      getBucketName: jest.fn<(bucket?: 'documents' | 'media') => string>()
        .mockImplementation((bucket = 'documents') => bucket),
    };
    const catalog: ModelCatalog = {
      listForOwner: async () => [{ id: 'plan-model', kind: 'PLAN', label: 'Plan model' }],
      resolvePlan: async () => ({
        creditPerInputToken: 1,
        creditPerOutputToken: 1,
        id: 'plan-model',
        model: 'model',
        planIds: ['free'],
      }),
    };
    const service = new ContentService(
      repository as never,
      storage as never,
      null as never,
      null as never,
      catalog,
      { storage: { mediaEnabled: true } } as never,
    );

    await service.createUploadUrl('owner-id', {
      originalName: 'lecture.pdf',
      sizeBytes: 1024,
      type: DocumentType.PDF,
      selection: { customModelConfigId: null, kind: 'PLAN', platformModelId: 'plan-model' },
    });

    expect(storage.createPresignedPostUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^owner-id\/.+\.pdf$/u),
      'application/pdf',
      1024,
      'documents',
    );
    expect(storage.getBucketName).toHaveBeenCalledWith('documents');
  });

  it('rejects a media upload over the policy cap before creating a Document', async () => {
    const repository = { createUploaded: jest.fn() };
    const service = new ContentService(
      repository as never,
      null as never,
      null as never,
      null as never,
      null as never,
      { storage: { mediaEnabled: true } } as never,
    );

    await expect(service.createUploadUrl('owner-id', {
      originalName: 'lecture.mp4',
      sizeBytes: MAX_MP4_SIZE_BYTES + 1,
      type: DocumentType.VIDEO,
      selection: { customModelConfigId: null, kind: 'PLAN', platformModelId: 'plan-model' },
    })).rejects.toMatchObject({ status: 400 });
    expect(repository.createUploaded).not.toHaveBeenCalled();
  });

  it('rejects media uploads with an explicit disabled error by default', async () => {
    const repository = { createUploaded: jest.fn() };
    const service = new ContentService(
      repository as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );

    await expect(service.createUploadUrl('owner-id', {
      originalName: 'lecture.mp4',
      sizeBytes: 1024,
      type: DocumentType.VIDEO,
      selection: { customModelConfigId: null, kind: 'PLAN', platformModelId: 'plan-model' },
    })).rejects.toMatchObject({
      response: { code: 'MEDIA_UPLOADS_DISABLED' },
      status: 409,
    });
    expect(repository.createUploaded).not.toHaveBeenCalled();
  });
});
