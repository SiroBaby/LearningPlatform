import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';

import type { ModelCatalog } from '../ai/contracts/model-selection.contracts';
import { ContentService } from './content.service';
import { Document } from './entities/document.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';

const EXPECTED_RESPONSE = {
  code: 'MEDIA_REQUIRES_PLATFORM_MODEL',
  message: 'Audio and video Documents can only be processed with a platform model, not a custom model.',
  retryable: false,
};
const inputCustomSelection = { customModelConfigId: 'owned-config', kind: 'CUSTOM', platformModelId: null } as const;
const catalog: ModelCatalog = {
  listForOwner: async () => [{ id: 'owned-config', kind: 'CUSTOM', label: 'Owner model' }],
  resolvePlan: async () => null,
};
const mediaConfig = { storage: { mediaEnabled: true } } as never;

const createMediaDocument = (status: DocumentStatus): Document => Object.assign(new Document(), {
  customModelConfigId: 'owned-config',
  errorCode: null,
  id: 'document-1',
  modelSelectionKind: 'CUSTOM' as const,
  originalName: 'lecture.mp3',
  ownerId: 'owner-1',
  platformModelId: null,
  sizeBytes: '1024',
  status,
  storageRef: 'media/owner-1/lecture.mp3',
  type: DocumentType.AUDIO,
});

describe('Custom AI is not allowed for audio/video (D5 of #160)', () => {
  it.each([DocumentType.AUDIO, DocumentType.VIDEO])('rejects the %s estimate with a business error code', async (inputType) => {
    const service = new ContentService(null as never, null as never, null as never, null as never, catalog, mediaConfig);

    const actualError = await service.estimateBeforeUpload('owner-1', {
      sizeBytes: 1024,
      type: inputType,
      selection: inputCustomSelection,
    }).catch((error: unknown) => error);

    expect(actualError).toBeInstanceOf(BadRequestException);
    expect((actualError as BadRequestException).getResponse()).toEqual(EXPECTED_RESPONSE);
  });

  it('rejects upload URL creation before persisting a Document or signing a URL', async () => {
    const repository = { createUploaded: jest.fn() };
    const storage = { createPresignedPostUrl: jest.fn() };
    const service = new ContentService(repository as never, storage as never, null as never, null as never, catalog, mediaConfig);

    const actualError = await service.createUploadUrl('owner-1', {
      originalName: 'lecture.mp4',
      sizeBytes: 1024,
      type: DocumentType.VIDEO,
      selection: inputCustomSelection,
    }).catch((error: unknown) => error);

    expect((actualError as BadRequestException).getResponse()).toEqual(EXPECTED_RESPONSE);
    expect(repository.createUploaded).not.toHaveBeenCalled();
    expect(storage.createPresignedPostUrl).not.toHaveBeenCalled();
  });

  it('rejects confirm of a custom-model media Document before starting the probe', async () => {
    const repository = {
      confirmMediaProbe: jest.fn(),
      findByOwnerId: async (): Promise<Document> => createMediaDocument(DocumentStatus.UPLOADED),
    };
    const service = new ContentService(repository as never, { getBucketName: () => 'media' } as never, null as never, null as never);

    const actualError = await service.confirm('owner-1', 'document-1').catch((error: unknown) => error);

    expect((actualError as BadRequestException).getResponse()).toEqual(EXPECTED_RESPONSE);
    expect(repository.confirmMediaProbe).not.toHaveBeenCalled();
  });

  it('keeps a custom-model estimate for PDF working', async () => {
    const service = new ContentService(null as never, null as never, null as never, null as never, catalog, mediaConfig);

    const actualEstimate = await service.estimateBeforeUpload('owner-1', {
      sizeBytes: 1024,
      type: DocumentType.PDF,
      selection: inputCustomSelection,
    });

    expect(actualEstimate).toEqual({ estimatedCredits: 0, precision: 'COARSE', selectedModelKind: 'CUSTOM', selectedModelLabel: 'Owner model' });
  });
});
