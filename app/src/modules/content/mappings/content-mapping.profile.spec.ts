import { classes } from '@automapper/classes';
import { createMapper, Mapper } from '@automapper/core';

import { UploadUrlResult } from '../contracts/upload-url.result';
import { DocumentQuizResult } from '../contracts/document-quiz.result';
import { DocumentEstimateResult } from '../contracts/document-estimate.result';
import { ConfirmDocumentResponseDto } from '../dto/confirm-document.response.dto';
import { DocumentQuizResponseDto } from '../dto/document-quiz.response.dto';
import { DocumentResponseDto } from '../dto/document.response.dto';
import { UploadUrlResponseDto } from '../dto/upload-url.response.dto';
import { DocumentEstimateResponseDto } from '../../ai/dto/document-estimate.response.dto';
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
      sizeBytes: '248320',
      status: DocumentStatus.READY,
      storageRef: 'internal/object-key.pdf',
      type: DocumentType.PDF,
      updatedAt: new Date('2026-06-21T12:35:56.789Z'),
    });

    const actual = mapper.map(document, Document, DocumentResponseDto);

    expect(actual).toMatchObject({
      createdAt: '2026-06-21T12:34:56.789Z',
      budgetStatus: null,
      id: document.id,
      originalName: document.originalName,
      sizeBytes: 248320,
      status: DocumentStatus.READY,
      updatedAt: '2026-06-21T12:35:56.789Z',
    });
    expect(actual).not.toHaveProperty('ownerId');
    expect(actual).not.toHaveProperty('storageRef');
  });

  it('preserve nullable Document fields as explicit nulls in response DTO', () => {
    const document = Object.assign(new Document(), {
      createdAt: new Date('2026-06-21T12:34:56.789Z'),
      durationSec: null,
      errorCode: null,
      errorMessage: null,
      estimateStatus: null,
      estimatedCredits: null,
      id: 'c1ce6db5-3afd-4d8a-a134-902847cc4f87',
      language: null,
      originalName: 'bai-giang.pdf',
      ownerId: 'd9c63d87-9ec5-4f00-9ab7-32d35a5b1e7e',
      pageCount: null,
      selectedModelKind: null,
      selectedModelLabel: null,
      settledCredits: null,
      sizeBytes: '248320',
      status: DocumentStatus.FAILED,
      storageRef: 'internal/object-key.pdf',
      type: DocumentType.PDF,
      updatedAt: new Date('2026-06-21T12:35:56.789Z'),
    });

    const actual = mapper.map(document, Document, DocumentResponseDto);

    expect(actual).toEqual({
      budgetStatus: null,
      createdAt: '2026-06-21T12:34:56.789Z',
      durationSec: null,
      errorCode: null,
      errorMessage: null,
      estimateStatus: null,
      estimatedCredits: null,
      id: document.id,
      language: null,
      originalName: document.originalName,
      pageCount: null,
      selectedModelKind: null,
      selectedModelLabel: null,
      settledCredits: null,
      sizeBytes: 248320,
      status: DocumentStatus.FAILED,
      type: DocumentType.PDF,
      updatedAt: '2026-06-21T12:35:56.789Z',
    });
    expect(Object.prototype.hasOwnProperty.call(actual, 'language')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(actual, 'durationSec')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(actual, 'pageCount')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(actual, 'errorMessage')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(actual, 'errorCode')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(actual, 'selectedModelKind')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(actual, 'selectedModelLabel')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(actual, 'estimateStatus')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(actual, 'estimatedCredits')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(actual, 'settledCredits')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(actual, 'budgetStatus')).toBe(true);
    expect(actual).not.toHaveProperty('ownerId');
    expect(actual).not.toHaveProperty('storageRef');
  });

  it('map raw upload result sang public response DTO', () => {
    const result = Object.assign(new UploadUrlResult(), {
      bucket: 'documents',
      documentId: 'c1ce6db5-3afd-4d8a-a134-902847cc4f87',
      expirySec: 300,
      objectKey: 'internal/object-key.pdf',
      uploadFields: {
        bucket: 'documents',
        key: 'owner/document.pdf',
        'Content-Type': 'application/pdf',
        Policy: 'signed-policy',
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': 'ACCESS_KEY/20260904/us-east-1/s3/aws4_request',
        'X-Amz-Date': '20260904T000000Z',
        'X-Amz-Signature': 'signed-signature',
      },
      uploadUrl: 'https://storage.example/upload',
    });

    const actual = mapper.map(result, UploadUrlResult, UploadUrlResponseDto);

    expect(actual).toEqual({
      documentId: result.documentId,
      expirySec: result.expirySec,
      uploadFields: result.uploadFields,
      uploadUrl: result.uploadUrl,
    });
  });

  it('maps the pre-upload estimate through AutoMapper', () => {
    const result = Object.assign(new DocumentEstimateResult(), {
      estimatedCredits: 1024,
      precision: 'COARSE' as const,
      selectedModelKind: 'PLAN' as const,
      selectedModelLabel: 'Configured model',
    });

    expect(mapper.map(result, DocumentEstimateResult, DocumentEstimateResponseDto)).toEqual({
      estimatedCredits: 1024,
      precision: 'COARSE',
      selectedModelKind: 'PLAN',
      selectedModelLabel: 'Configured model',
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
    expect(Object.prototype.hasOwnProperty.call(actual, 'status')).toBe(true);
  });

  it('maps the narrow Document Quiz discovery summary', () => {
    const result = Object.assign(new DocumentQuizResult(), {
      documentId: 'c1ce6db5-3afd-4d8a-a134-902847cc4f87',
      questionCount: 5,
      quizId: 'd9c63d87-9ec5-4f00-9ab7-32d35a5b1e7e',
    });

    const actual = mapper.map(result, DocumentQuizResult, DocumentQuizResponseDto);

    expect(actual).toEqual({
      documentId: result.documentId,
      questionCount: result.questionCount,
      quizId: result.quizId,
    });
  });
});
