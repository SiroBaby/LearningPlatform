import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException } from '@nestjs/common';

import type { ModelCatalog } from '../ai/contracts/model-selection.contracts';
import type { CreateUploadUrlCommand } from './contracts/create-upload-url.command';
import { ContentService } from './content.service';
import { DocumentType } from './enums/document-type.enum';

const VIDEO_ID = 'dQw4w9WgXcQ';
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const CATALOG: ModelCatalog = {
  listForOwner: async () => [
    { id: 'plan-model', kind: 'PLAN', label: 'Plan model' },
    { id: '5b6b7f6e-3d2c-4a52-8d58-0f8c9b0b1111', kind: 'CUSTOM', label: 'My model' },
  ],
  resolvePlan: async () => ({
    creditPerInputToken: 1,
    creditPerOutputToken: 1,
    id: 'plan-model',
    model: 'model',
    planIds: ['free'],
  }),
};

function createHarness(youtubeLessonsEnabled: boolean) {
  const repository = {
    createUploaded: jest.fn<(...args: unknown[]) => Promise<{ id: string }>>().mockResolvedValue({ id: 'document-id' }),
  };
  const storage = {
    createPresignedPostUrl: jest.fn<(...args: unknown[]) => Promise<{
      expirySec: number;
      formFields: Record<string, string>;
      url: string;
    }>>().mockResolvedValue({ expirySec: 300, formFields: {}, url: 'https://storage.example/upload' }),
    getBucketName: jest.fn<(bucket?: 'documents' | 'media') => string>().mockReturnValue('documents'),
  };
  const service = new ContentService(
    repository as never,
    storage as never,
    null as never,
    null as never,
    CATALOG,
    { storage: { mediaEnabled: false }, youtubeLessonsEnabled } as never,
  );
  return { repository, service, storage };
}

function buildCommand(overrides: Partial<CreateUploadUrlCommand> = {}): CreateUploadUrlCommand {
  return {
    originalName: 'bai-giang.vi.vtt',
    selection: { customModelConfigId: null, kind: 'PLAN', platformModelId: 'plan-model' },
    sizeBytes: 2048,
    type: DocumentType.YOUTUBE,
    youtubeUrl: WATCH_URL,
    ...overrides,
  };
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject');
}

describe('ContentService.createUploadUrl for YOUTUBE', () => {
  it('stores only the video id and keeps the subtitle extension in the documents bucket', async () => {
    const { repository, service, storage } = createHarness(true);

    await service.createUploadUrl('owner-id', buildCommand({ originalName: 'bai-giang.VTT' }));

    expect(storage.createPresignedPostUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^owner-id\/.+\.vtt$/u),
      'text/plain',
      2048,
      'documents',
    );
    const persisted = repository.createUploaded.mock.calls[0][1] as Record<string, unknown>;
    expect(persisted.youtubeVideoId).toBe(VIDEO_ID);
    expect(JSON.stringify(persisted)).not.toContain('youtube.com');
    expect(persisted).not.toHaveProperty('youtubeUrl');
  });

  it('keeps the .srt extension for an SRT subtitle', async () => {
    const { service, storage } = createHarness(true);

    await service.createUploadUrl('owner-id', buildCommand({ originalName: 'bai-giang.srt' }));

    expect(storage.createPresignedPostUrl).toHaveBeenCalledWith(expect.stringMatching(/\.srt$/u), 'text/plain', 2048, 'documents');
  });

  it('allows a CUSTOM model for a YOUTUBE Document', async () => {
    const { repository, service } = createHarness(true);

    await service.createUploadUrl('owner-id', buildCommand({
      selection: { customModelConfigId: '5b6b7f6e-3d2c-4a52-8d58-0f8c9b0b1111', kind: 'CUSTOM', platformModelId: null },
    }));

    expect(repository.createUploaded).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['unsupported host', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['playlist', 'https://www.youtube.com/playlist?list=PLabcdefghij'],
    ['garbage', 'khong-phai-link'],
  ])('rejects %s with YOUTUBE_URL_INVALID', async (_label, youtubeUrl) => {
    const { repository, service } = createHarness(true);

    const actualError = await captureRejection(service.createUploadUrl('owner-id', buildCommand({ youtubeUrl })));

    expect(actualError).toBeInstanceOf(BadRequestException);
    expect((actualError as BadRequestException).getResponse()).toMatchObject({ code: 'YOUTUBE_URL_INVALID' });
    expect(repository.createUploaded).not.toHaveBeenCalled();
  });

  it('requires a URL for YOUTUBE', async () => {
    const { service } = createHarness(true);

    const actualError = await captureRejection(service.createUploadUrl('owner-id', buildCommand({ youtubeUrl: undefined })));

    expect((actualError as BadRequestException).getResponse()).toMatchObject({ code: 'YOUTUBE_URL_INVALID' });
  });

  it('rejects a URL on any other document type', async () => {
    const { repository, service } = createHarness(true);

    const actualError = await captureRejection(service.createUploadUrl('owner-id', buildCommand({
      originalName: 'ghi-chu.txt',
      type: DocumentType.TEXT,
    })));

    expect((actualError as BadRequestException).getResponse()).toMatchObject({ code: 'YOUTUBE_URL_INVALID' });
    expect(repository.createUploaded).not.toHaveBeenCalled();
  });

  it('rejects a subtitle file with another extension', async () => {
    const { service } = createHarness(true);

    const actualError = await captureRejection(service.createUploadUrl('owner-id', buildCommand({ originalName: 'bai-giang.txt' })));

    expect(actualError).toBeInstanceOf(BadRequestException);
  });

  it('rejects a subtitle over 5 MiB', async () => {
    const { service } = createHarness(true);

    const actualError = await captureRejection(service.createUploadUrl('owner-id', buildCommand({ sizeBytes: 5 * 1024 * 1024 + 1 })));

    expect(actualError).toBeInstanceOf(BadRequestException);
  });

  it('is refused with YOUTUBE_LESSONS_DISABLED while the flag is off, for upload and estimate', async () => {
    const { repository, service } = createHarness(false);

    const uploadError = await captureRejection(service.createUploadUrl('owner-id', buildCommand()));
    const estimateError = await captureRejection(service.estimateBeforeUpload('owner-id', {
      selection: { customModelConfigId: null, kind: 'PLAN', platformModelId: 'plan-model' },
      sizeBytes: 2048,
      type: DocumentType.YOUTUBE,
    }));

    expect(uploadError).toBeInstanceOf(ConflictException);
    expect((uploadError as ConflictException).getResponse()).toMatchObject({ code: 'YOUTUBE_LESSONS_DISABLED' });
    expect((estimateError as ConflictException).getResponse()).toMatchObject({ code: 'YOUTUBE_LESSONS_DISABLED' });
    expect(repository.createUploaded).not.toHaveBeenCalled();
  });

  it('does not touch existing document types while the flag is off', async () => {
    const { repository, service } = createHarness(false);

    await service.createUploadUrl('owner-id', {
      originalName: 'ghi-chu.txt',
      selection: { customModelConfigId: null, kind: 'PLAN', platformModelId: 'plan-model' },
      sizeBytes: 100,
      type: DocumentType.TEXT,
    });

    expect(repository.createUploaded).toHaveBeenCalledTimes(1);
  });
});
