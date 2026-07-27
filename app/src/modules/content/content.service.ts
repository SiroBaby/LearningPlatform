import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';

import { StorageService } from '../../storage/storage.service';
import {
  QUIZ_DISCOVERY,
  type QuizDiscovery,
} from '../assessment/contracts/quiz-discovery.port';
import {
  STORAGE_VERIFIER,
  StorageVerifier,
} from '../../storage/contracts/storage-verifier.port';
import { CreateUploadUrlCommand } from './contracts/create-upload-url.command';
import { DocumentQuizResult } from './contracts/document-quiz.result';
import { DocumentEstimateResult } from './contracts/document-estimate.result';
import { resolveDocumentUploadPolicy } from './contracts/document-upload-policy';
import { UploadUrlResult } from './contracts/upload-url.result';
import { Document } from './entities/document.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { ContentRepository } from './repositories/content.repository';
import {
  MODEL_CATALOG,
  type DocumentModelSelection,
  type ModelCatalog,
  type PlanModelCatalogItem,
} from '../ai/contracts/model-selection.contracts';

const COARSE_INPUT_TOKEN_BYTES = 4;
const COARSE_OUTPUT_TOKEN_CAP = 256;

@Injectable()
export class ContentService {
  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly storage: StorageService,
    @Inject(STORAGE_VERIFIER)
    private readonly verifier: StorageVerifier,
    @Inject(QUIZ_DISCOVERY)
    private readonly quizzes: QuizDiscovery,
    @Optional() @Inject(MODEL_CATALOG) private readonly models?: ModelCatalog,
  ) {}

  /**
   * Tạo document (status=UPLOADED) + cấp presigned PUT URL.
   * Object key sinh ngẫu nhiên (UUID) — KHÔNG dùng tên file gốc làm path
   * (bài học 07-docs: chống path traversal).
   */
  async createUploadUrl(
    ownerId: string,
    command: CreateUploadUrlCommand,
  ): Promise<UploadUrlResult> {
    const policy = resolveDocumentUploadPolicy(command.type, command.originalName);
    const estimate = await this.estimateModelSelection(ownerId, command.sizeBytes, command.selection);
    const objectKey = `${ownerId}/${randomUUID()}${policy.extension}`;

    const persistedCommand = { ...command, estimatedCredits: estimate.estimatedCredits, selectedModelLabel: estimate.selectedModelLabel };
    const saved = await this.contentRepository.createUploaded(ownerId, persistedCommand, objectKey);

    const { url, formFields, expirySec } = await this.storage.createPresignedPostUrl(
      objectKey,
      policy.contentType,
      command.sizeBytes,
    );

    return Object.assign(new UploadUrlResult(), {
      documentId: saved.id,
      uploadUrl: url,
      uploadFields: formFields,
      objectKey,
      bucket: this.storage.getBucketName(),
      expirySec,
    });
  }

  private async estimateModelSelection(
    ownerId: string,
    sizeBytes: number,
    selection: DocumentModelSelection,
  ): Promise<{ readonly estimatedCredits: number; readonly selectedModelLabel: string }> {
    if (!this.models) throw new Error('Model catalog is unavailable');
    let plan: PlanModelCatalogItem | null = null;
    if (selection.kind === 'PLAN') {
      plan = selection.platformModelId
        ? await this.models.resolvePlan(ownerId, selection.platformModelId)
        : null;
      if (!selection.platformModelId || selection.customModelConfigId || !plan) {
        throw new BadRequestException('Selected platform model is unavailable');
      }
    } else if (!selection.customModelConfigId || selection.platformModelId) {
      throw new BadRequestException('Selected custom model is invalid');
    }
    const catalog = await this.models.listForOwner(ownerId);
    const selectedId = selection.kind === 'PLAN' ? selection.platformModelId : selection.customModelConfigId;
    const selected = catalog.find((model) => model.id === selectedId && model.kind === selection.kind);
    if (!selected) {
      throw new BadRequestException('Selected custom model is unavailable');
    }
    return {
      estimatedCredits: plan
        ? this.estimatePlatformCredits(sizeBytes, plan)
        : 0,
      selectedModelLabel: selected.label,
    };
  }

  private estimatePlatformCredits(
    sizeBytes: number,
    model: PlanModelCatalogItem,
  ): number {
    const estimatedInputTokens = Math.ceil(sizeBytes / COARSE_INPUT_TOKEN_BYTES);
    return Math.max(
      1,
      estimatedInputTokens * model.creditPerInputToken +
        COARSE_OUTPUT_TOKEN_CAP * model.creditPerOutputToken,
    );
  }

  // Ownership enforcement từ ngày 1 (ADR-0011): luôn lọc theo owner_id
  async findById(ownerId: string, id: string): Promise<Document | null> {
    return this.contentRepository.findByOwnerId(ownerId, id);
  }

  async findAll(ownerId: string): Promise<Document[]> {
    return this.contentRepository.findAllByOwnerId(ownerId);
  }

  async estimateBeforeUpload(
    ownerId: string,
    input: { readonly sizeBytes: number; readonly type: string; readonly selection: DocumentModelSelection },
  ): Promise<DocumentEstimateResult> {
    const estimate = await this.estimateModelSelection(ownerId, input.sizeBytes, input.selection);
    return Object.assign(new DocumentEstimateResult(), {
      estimatedCredits: estimate.estimatedCredits,
      precision: 'COARSE',
      selectedModelKind: input.selection.kind,
      selectedModelLabel: estimate.selectedModelLabel,
    });
  }

  async findQuiz(ownerId: string, documentId: string): Promise<DocumentQuizResult> {
    const document = await this.contentRepository.findByOwnerId(ownerId, documentId);
    if (!document) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: `Document ${documentId} not found`,
      });
    }
    const quiz = await this.quizzes.findByOwnerAndDocumentId(ownerId, documentId);
    if (!quiz) {
      if (
        document.status === DocumentStatus.UPLOADED ||
        document.status === DocumentStatus.PROCESSING
      ) {
        throw new ConflictException({
          code: 'QUIZ_NOT_READY',
          message: 'Quiz is still being prepared. Please try again shortly.',
          retryable: true,
        });
      }
      if (document.status === DocumentStatus.FAILED) {
        throw new ConflictException({
          code: 'DOCUMENT_PROCESSING_FAILED',
          message: document.errorMessage ?? 'Document processing failed. Please try again later.',
          retryable: document.budgetStatus === 'EXHAUSTED',
        });
      }
      throw new InternalServerErrorException({
        code: 'QUIZ_INVARIANT_VIOLATION',
        message: 'Quiz is unavailable due to a system error. Please try again later.',
        retryable: false,
      });
    }
    return Object.assign(new DocumentQuizResult(), quiz);
  }

  /**
   * Confirm upload xong: verify file trên storage, rồi trong MỘT transaction
   * chỉ chạm schema `course` (ADR-0010): CAS status UPLOADED/FAILED -> PROCESSING
   * + ghi outbox(DocumentReadyForProcessing) mang owner_id (ADR-0005/0018).
   * Idempotent qua CAS: re-confirm không tạo outbox thứ hai.
   */
  async confirm(ownerId: string, id: string): Promise<Document> {
    const document = await this.contentRepository.findByOwnerId(ownerId, id);
    if (!document) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    const v = await this.verifier.verify(document.storageRef, document.type);
    if (
      !v.exists ||
      !v.magicBytesValid ||
      v.sizeBytes !== Number(document.sizeBytes)
    ) {
      throw new BadRequestException('Uploaded file failed verification');
    }

    const confirmed = await this.contentRepository.confirmProcessing(ownerId, id, {
      customModelConfigId: document.customModelConfigId,
      kind: document.modelSelectionKind,
      platformModelId: document.platformModelId,
    });
    if (!confirmed) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    return confirmed;
  }
}
