import 'reflect-metadata';

import { classes } from '@automapper/classes';
import { createMapper, type Mapper } from '@automapper/core';
import { describe, expect, it, jest } from '@jest/globals';
import { ValidationPipe } from '@nestjs/common';

import { ContentController } from './content.controller';
import type { ContentService } from './content.service';
import { SubtitlePreviewResult } from './contracts/subtitle-preview.result';
import { ConfirmDocumentDto } from './dto/confirm-document.dto';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { Document } from './entities/document.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { ContentMappingProfile } from './mappings/content-mapping.profile';
import type { SubtitlePreviewService } from './subtitles/subtitle-preview.service';

const DOCUMENT_ID = 'c1ce6db5-3afd-4d8a-a134-902847cc4f87';
const OWNER_ID = 'd9c63d87-9ec5-4f00-9ab7-32d35a5b1e7e';

function createController(content: Partial<ContentService>, preview: Partial<SubtitlePreviewService> = {}): ContentController {
  const mapper: Mapper = createMapper({ strategyInitializer: classes() });
  new ContentMappingProfile(mapper);
  return new ContentController(content as ContentService, mapper, preview as SubtitlePreviewService);
}

describe('ContentController YouTube endpoints', () => {
  it('forwards the rights confirmation of the confirm body', async () => {
    const confirm = jest.fn<ContentService['confirm']>().mockResolvedValue(
      Object.assign(new Document(), { id: DOCUMENT_ID, status: DocumentStatus.PROCESSING }),
    );
    const controller = createController({ confirm });

    const actualResponse = await controller.confirm(OWNER_ID, DOCUMENT_ID, Object.assign(new ConfirmDocumentDto(), { rightsConfirmed: true }));

    expect(confirm).toHaveBeenCalledWith(OWNER_ID, DOCUMENT_ID, { rightsConfirmed: true });
    expect(actualResponse).toMatchObject({ documentId: DOCUMENT_ID, status: DocumentStatus.PROCESSING });
  });

  it('confirms without a body for existing document types', async () => {
    const confirm = jest.fn<ContentService['confirm']>().mockResolvedValue(
      Object.assign(new Document(), { id: DOCUMENT_ID, status: DocumentStatus.PROCESSING }),
    );
    const controller = createController({ confirm });

    await controller.confirm(OWNER_ID, DOCUMENT_ID, undefined);

    expect(confirm).toHaveBeenCalledWith(OWNER_ID, DOCUMENT_ID, { rightsConfirmed: undefined });
  });

  it('maps the subtitle preview result into the frozen response shape', async () => {
    const preview = jest.fn<SubtitlePreviewService['preview']>().mockResolvedValue(Object.assign(new SubtitlePreviewResult(), {
      charCount: 17,
      cueCount: 1,
      cues: [{ endSec: 4.25, startSec: 1.5, text: 'Xin chào các bạn.' }],
      durationSec: 5,
      format: 'VTT',
    }));
    const controller = createController({}, { preview });

    const actualResponse = await controller.previewSubtitle(OWNER_ID, DOCUMENT_ID);

    expect(preview).toHaveBeenCalledWith(OWNER_ID, DOCUMENT_ID);
    expect(actualResponse).toEqual({
      charCount: 17,
      cueCount: 1,
      cues: [{ endSec: 4.25, startSec: 1.5, text: 'Xin chào các bạn.' }],
      durationSec: 5,
      format: 'VTT',
    });
  });
});

describe('request DTO validation for YouTube', () => {
  const pipe = new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true });

  it('accepts youtubeUrl on the upload request and rejects an oversized one', async () => {
    const valid = {
      modelSelectionKind: 'PLAN',
      originalName: 'bai-giang.vi.vtt',
      platformModelId: 'platform-default',
      sizeBytes: 100,
      type: 'YOUTUBE',
      youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
    };

    await expect(pipe.transform(valid, { metatype: CreateUploadUrlDto, type: 'body' })).resolves.toMatchObject({ youtubeUrl: valid.youtubeUrl });
    await expect(pipe.transform({ ...valid, youtubeUrl: `https://youtu.be/${'a'.repeat(2048)}` }, { metatype: CreateUploadUrlDto, type: 'body' })).rejects.toThrow();
  });

  it('accepts an empty confirm body and a boolean rightsConfirmed only', async () => {
    await expect(pipe.transform({}, { metatype: ConfirmDocumentDto, type: 'body' })).resolves.toEqual({});
    await expect(pipe.transform({ rightsConfirmed: true }, { metatype: ConfirmDocumentDto, type: 'body' })).resolves.toEqual({ rightsConfirmed: true });
    await expect(pipe.transform({ rightsConfirmed: 'yes' }, { metatype: ConfirmDocumentDto, type: 'body' })).rejects.toThrow();
    await expect(pipe.transform({ extra: 1 }, { metatype: ConfirmDocumentDto, type: 'body' })).rejects.toThrow();
  });
});
