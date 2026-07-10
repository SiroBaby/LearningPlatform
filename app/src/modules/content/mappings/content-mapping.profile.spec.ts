import { classes } from '@automapper/classes';
import { createMapper, Mapper } from '@automapper/core';

import { UploadUrlResult } from '../contracts/upload-url.result';
import { ConfirmDocumentResponseDto } from '../dto/confirm-document.response.dto';
import { DocumentResponseDto } from '../dto/document.response.dto';
import { UploadUrlResponseDto } from '../dto/upload-url.response.dto';
import { Document } from '../entities/document.entity';
import { DocumentStatus } from '../enums/document-status.enum';
import { DocumentType } from '../enums/document-type.enum';
import { ContentMappingProfile } from './content-mapping.profile';

describe('ContentMappingProfile', () => {
  let mapper: Mapper;

  beforeEach(() => {
    mapper = createMapper({ strategyInitializer: classes() });
    new ContentMappingProfile(mapper);
  });

  it('map Document sang response DTO với datetime UTC', () => {
    const document = Object.assign(new Document(), {
      createdAt: new Date('2026-06-21T12:34:56.789Z'),
      durationSec: null,
      errorMessage: null,
      id: 'c1ce6db5-3afd-4d8a-a134-902847cc4f87',
      language: 'vi',
      originalName: 'bai-giang.pdf',
      ownerId: 'd9c63d87-9ec5-4f00-9ab7-32d35a5b1e7e',
      pageCount: 12,
      sizeBytes: 248320,
      status: DocumentStatus.READY,
      storageRef: 'internal/object-key.pdf',
      type: DocumentType.PDF,
      updatedAt: new Date('2026-06-21T12:35:56.789Z'),
    });

    const actual = mapper.map(document, Document, DocumentResponseDto);

    expect(actual).toMatchObject({
      createdAt: '2026-06-21T12:34:56.789Z',
      id: document.id,
      originalName: document.originalName,
      updatedAt: '2026-06-21T12:35:56.789Z',
    });
    expect(actual).not.toHaveProperty('ownerId');
    expect(actual).not.toHaveProperty('storageRef');
  });

  it('map raw upload result sang public response DTO', () => {
    const result = Object.assign(new UploadUrlResult(), {
      bucket: 'documents',
      documentId: 'c1ce6db5-3afd-4d8a-a134-902847cc4f87',
      expirySec: 300,
      objectKey: 'internal/object-key.pdf',
      uploadUrl: 'https://storage.example/upload',
    });

    const actual = mapper.map(result, UploadUrlResult, UploadUrlResponseDto);

    expect(actual).toEqual({
      documentId: result.documentId,
      expirySec: result.expirySec,
      uploadUrl: result.uploadUrl,
    });
  });

  it('map Document id sang documentId cho confirm response', () => {
    const document = Object.assign(new Document(), {
      id: 'c1ce6db5-3afd-4d8a-a134-902847cc4f87',
      status: DocumentStatus.PROCESSING,
    });

    const actual = mapper.map(document, Document, ConfirmDocumentResponseDto);

    expect(actual).toEqual({
      documentId: document.id,
      status: DocumentStatus.PROCESSING,
    });
  });
});
