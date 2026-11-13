import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';

import { DateTimeUtil } from '../../common/datetime.util';
import { createApplicationLogger } from '../../common/logging/application-logger.factory';
import { ApplicationConfigService } from '../../config/application-config.service';
import { StorageService } from '../../storage/storage.service';
import { normalizeStorageVersionId } from '../../storage/storage-version-id';
import {
  QUIZ_DISCOVERY,
  type QuizDiscovery,
} from '../assessment/contracts/quiz-discovery.port';
import {
  STORAGE_VERIFIER,
  type ObjectVerification,
  type StorageVerifier,
} from '../../storage/contracts/storage-verifier.port';
import { CreateUploadUrlCommand } from './contracts/create-upload-url.command';
import { calculatePurgeNotBefore } from './contracts/document-purge-policy';
import { DocumentQuizResult } from './contracts/document-quiz.result';
import { COARSE_INPUT_TOKEN_BYTES, COARSE_OUTPUT_TOKEN_CAP } from './credit-estimation/credit-estimation.constants';
import { DocumentEstimateResult } from './contracts/document-estimate.result';
import { InsufficientCreditsError } from './contracts/insufficient-credits.error';
import {
  assertDocumentUploadSize,
  findMatchedExtension,
  getDocumentUploadPolicy,
  resolveDocumentUploadPolicy,
} from './contracts/document-upload-policy';
import type { CreateMediaPlaybackUrlCommand } from './contracts/media-playback-url.command';
import { calculateMediaPlaybackTtlSec } from './contracts/media-playback-policy';
import { MediaPlaybackUrlResult } from './contracts/media-playback-url.result';
import { UploadUrlResult } from './contracts/upload-url.result';
import { MEDIA_PROBE_POLICY_VERSION } from './contracts/media-probe-policy';
import { SubtitlePrerequisiteError } from './contracts/subtitle-snapshot';
import { normalizeYoutubeVideoId } from './youtube/youtube-video-id';
import { Document } from './entities/document.entity';
import type { CreatePresignedGetUrlInput } from '../../storage/storage.service';
import type { DocumentPurgeLocator } from './entities/document-purge-manifest.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { isDocumentProcessingFailureRetryable } from '../ai/contracts/document-processing-result';
import {
  ContentRepository,
  type DocumentStorageBuckets,
} from './repositories/content.repository';
import {
  MODEL_CATALOG,
  type DocumentModelSelection,
  type ModelCatalog,
  type PlanModelCatalogItem,
} from '../ai/contracts/model-selection.contracts';

const isMediaDocumentType = (type: DocumentType): boolean => type === DocumentType.AUDIO || type === DocumentType.VIDEO;
const SAFE_LOG_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/u;
const safeLogToken = (value: unknown): string =>
  typeof value === 'string' && SAFE_LOG_TOKEN.test(value) ? value : 'unknown';
type ProcessingStartMode = 'CONFIRM' | 'RETRY';

@Injectable()
export class ContentService {
  private readonly logger = createApplicationLogger({ context: ContentService.name });

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly storage: StorageService,
    @Inject(STORAGE_VERIFIER)
    private readonly verifier: StorageVerifier,
    @Inject(QUIZ_DISCOVERY)
    private readonly quizzes: QuizDiscovery,
    @Optional() @Inject(MODEL_CATALOG) private readonly models?: ModelCatalog,
    @Optional() private readonly config?: ApplicationConfigService,
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
    this.assertYoutubeLessonsEnabled(command.type);
    const policy = resolveDocumentUploadPolicy(command.type, command.originalName);
    this.assertMediaUploadsEnabled(policy.bucket);
    const youtubeVideoId = this.resolveYoutubeVideoId(command);
    assertDocumentUploadSize(policy, command.sizeBytes);
    const estimate = await this.estimateModelSelection(ownerId, command.sizeBytes, command.selection, command.type);
    const extension = findMatchedExtension(policy, command.originalName) ?? policy.extensions[0];
    const objectKey = policy.bucket === 'media'
      ? `media/${ownerId}/${randomUUID()}${extension}`
      : `${ownerId}/${randomUUID()}${extension}`;

    const { youtubeUrl: _discardedRawUrl, ...storableCommand } = command;
    const persistedCommand = {
      ...storableCommand,
      estimatedCredits: estimate.estimatedCredits,
      selectedModelLabel: estimate.selectedModelLabel,
      youtubeVideoId,
    };
    const saved = await this.contentRepository.createUploaded(ownerId, persistedCommand, objectKey);

    const { url, formFields, expirySec } = await this.storage.createPresignedPostUrl(
      objectKey,
      policy.contentType,
      command.sizeBytes,
      policy.bucket,
    );

    return Object.assign(new UploadUrlResult(), {
      documentId: saved.id,
      uploadUrl: url,
      uploadFields: formFields,
      objectKey,
      bucket: this.storage.getBucketName(policy.bucket),
      expirySec,
    });
  }

  /**
   * Issues a short-lived presigned GET for an owned, READY media Document.
   * Ownership and status are re-checked on every call so refresh never outlives access.
   */
  async createMediaPlaybackUrl(command: CreateMediaPlaybackUrlCommand): Promise<MediaPlaybackUrlResult> {
    const { ownerId, documentId, reason } = command;
    const document = await this.findPlayableMediaDocument(ownerId, documentId);
    const locator = this.getPersistedMediaSourceLocator(document, this.storage.getBucketName('media'));
    if (!locator?.versionId) {
      throw this.rejectPlayback(documentId, this.mediaSourceIdentityUnavailable());
    }
    const durationSec = document.durationSec ?? null;
    const ttlSec = calculateMediaPlaybackTtlSec(durationSec);
    const signingDate = DateTimeUtil.nowUtc();
    const mimeType = document.type === DocumentType.VIDEO ? 'video/mp4' : 'audio/mpeg';
    const url = await this.signPlaybackUrl(documentId, {
      key: locator.key,
      versionId: locator.versionId,
      responseContentType: mimeType,
      expiresInSec: ttlSec,
      signingDate,
    });
    this.logger.log({ event: 'media.playback.url_issued', documentId, reason, ttlSec, documentType: document.type });
    return Object.assign(new MediaPlaybackUrlResult(), {
      url,
      expiresAt: new Date(signingDate.getTime() + ttlSec * 1000),
      ttlSec,
      mimeType,
      durationSec,
    });
  }

  private async findPlayableMediaDocument(ownerId: string, documentId: string): Promise<Document> {
    const document = await this.contentRepository.findByOwnerId(ownerId, documentId);
    if (!document || document.status === DocumentStatus.DELETING) {
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: `Document ${documentId} not found` });
    }
    if (!isMediaDocumentType(document.type)) {
      throw this.rejectPlayback(documentId, new ConflictException({
        code: 'MEDIA_PLAYBACK_NOT_AVAILABLE',
        message: 'This Document has no audio or video to play.',
        retryable: false,
      }));
    }
    if (document.status !== DocumentStatus.READY) {
      throw this.rejectPlayback(documentId, new ConflictException({
        code: 'MEDIA_PLAYBACK_NOT_READY',
        message: 'Media is not ready to play yet.',
        retryable: false,
      }));
    }
    if (!this.config?.storage.mediaEnabled) {
      throw this.rejectPlayback(documentId, this.mediaPlaybackUnavailable());
    }
    return document;
  }

  private async signPlaybackUrl(documentId: string, input: CreatePresignedGetUrlInput): Promise<string> {
    try {
      return await this.storage.createPresignedGetUrl(input, 'media');
    } catch (error) {
      const failure = (typeof error === 'object' && error !== null ? error : {}) as { name?: unknown; code?: unknown; Code?: unknown };
      this.logger.error({
        event: 'media.playback.sign_failed',
        documentId,
        errorName: safeLogToken(failure.name),
        code: safeLogToken(failure.Code ?? failure.code),
      });
      throw this.mediaPlaybackUnavailable();
    }
  }

  private rejectPlayback<T extends HttpException>(documentId: string, exception: T): T {
    const body = exception.getResponse() as { code?: string };
    this.logger.warn({ event: 'media.playback.url_rejected', documentId, code: safeLogToken(body.code) });
    return exception;
  }

  private mediaPlaybackUnavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'MEDIA_PLAYBACK_UNAVAILABLE',
      message: 'Media playback is temporarily unavailable. Please try again shortly.',
      retryable: true,
    });
  }

  private async estimateModelSelection(
    ownerId: string,
    sizeBytes: number,
    selection: DocumentModelSelection,
    type: DocumentType,
  ): Promise<{ readonly estimatedCredits: number | null; readonly selectedModelLabel: string }> {
    if (!this.models) throw new Error('Model catalog is unavailable');
    if (isMediaDocumentType(type) && selection.kind === 'CUSTOM') throw this.mediaRequiresPlatformModel();
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
      // Media duration is unknown until the probe (ADR-0031); never derive credits from video/audio bytes.
      estimatedCredits: this.estimateCreditsBeforeUpload(sizeBytes, type, plan),
      selectedModelLabel: selected.label,
    };
  }

  /** CUSTOM models cost nothing; media is unknown until the probe; everything else is size-based. */
  private estimateCreditsBeforeUpload(
    sizeBytes: number,
    type: DocumentType,
    plan: PlanModelCatalogItem | null,
  ): number | null {
    if (!plan) return 0;
    if (isMediaDocumentType(type)) return null;
    return this.estimatePlatformCredits(sizeBytes, plan);
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

  async delete(ownerId: string, id: string): Promise<Document> {
    const document = await this.contentRepository.findByOwnerId(ownerId, id);
    if (!document) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: `Document ${id} not found`,
      });
    }

    const isMediaDocument = document.type === DocumentType.AUDIO || document.type === DocumentType.VIDEO;
    const documentsBucket = this.storage.getBucketName('documents');
    const mediaBucket = isMediaDocument ? this.storage.getBucketName('media') : '';

    const buckets: DocumentStorageBuckets = {
      documents: documentsBucket,
      media: mediaBucket,
    };
    const mediaLocator = document.status !== DocumentStatus.DELETING &&
      isMediaDocument &&
      !this.hasPersistedMediaSourceIdentity(document, mediaBucket)
      ? await this.resolveMediaPurgeLocator(document, mediaBucket)
      : undefined;
    const deleted = await this.contentRepository.deleteOwnedDocument(
      ownerId,
      id,
      buckets,
      mediaLocator,
      calculatePurgeNotBefore(DateTimeUtil.nowUtc(), this.storage.presignExpirySeconds),
    );
    if (!deleted) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: `Document ${id} not found`,
      });
    }
    return deleted;
  }

  private hasPersistedMediaSourceIdentity(document: Document, mediaBucket: string): boolean {
    return this.getPersistedMediaSourceLocator(
      document,
      mediaBucket,
    ) !== null;
  }

  private getPersistedMediaSourceLocator(
    document: Document,
    mediaBucket: string,
  ): DocumentPurgeLocator | null {
    const versionId = normalizeStorageVersionId(document.mediaSourceVersionId);
    const etag = document.mediaSourceEtag?.trim();
    const contentLength = document.mediaSourceContentLength === null ||
      document.mediaSourceContentLength === undefined
      ? null
      : Number(document.mediaSourceContentLength);
    if (
      document.mediaSourceBucket?.trim() !== mediaBucket ||
      !versionId ||
      !etag ||
      contentLength === null ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength !== Number(document.sizeBytes)
    ) {
      return null;
    }
    return {
      bucket: mediaBucket,
      key: document.storageRef,
      versionId,
      etag,
      contentLength,
    };
  }

  private mediaSourceIdentityUnavailable(): ConflictException {
    return new ConflictException({
      code: 'MEDIA_SOURCE_IDENTITY_UNAVAILABLE',
      message: 'Media source identity is incomplete. Please upload the file again.',
      retryable: false,
    });
  }

  private async resolveMediaPurgeLocator(
    document: Document,
    mediaBucket: string,
  ): Promise<DocumentPurgeLocator> {
    let verification: ObjectVerification;
    try {
      verification = await this.verifier.verify(document.storageRef, document.type, 'media');
    } catch {
      throw this.mediaPurgeMetadataUnavailable();
    }

    const versionId = normalizeStorageVersionId(verification.versionId);
    const etag = verification.etag?.trim();
    const contentLength = verification.sizeBytes;
    if (
      !verification.exists ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength !== Number(document.sizeBytes) ||
      !versionId ||
      !etag
    ) {
      throw this.mediaPurgeMetadataUnavailable();
    }

    return {
      bucket: mediaBucket,
      key: document.storageRef,
      versionId,
      etag,
      contentLength,
    };
  }

  private mediaPurgeMetadataUnavailable(): ConflictException {
    return new ConflictException({
      code: 'DOCUMENT_PURGE_METADATA_UNAVAILABLE',
      message: 'Media metadata is temporarily unavailable. Please try deleting the Document again.',
      retryable: true,
    });
  }

  async estimateBeforeUpload(
    ownerId: string,
    input: { readonly sizeBytes: number; readonly type: DocumentType; readonly selection: DocumentModelSelection },
  ): Promise<DocumentEstimateResult> {
    this.assertYoutubeLessonsEnabled(input.type);
    const policy = getDocumentUploadPolicy(input.type);
    this.assertMediaUploadsEnabled(policy.bucket);
    assertDocumentUploadSize(policy, input.sizeBytes);
    const estimate = await this.estimateModelSelection(ownerId, input.sizeBytes, input.selection, input.type);
    return Object.assign(new DocumentEstimateResult(), {
      estimatedCredits: estimate.estimatedCredits,
      precision: estimate.estimatedCredits === null ? 'AFTER_MEDIA_CHECK' : 'COARSE',
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
    if (document.status === DocumentStatus.DELETING) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: `Document ${documentId} not found`,
      });
    }
    const quiz = await this.quizzes.findByOwnerAndDocumentId(ownerId, documentId);
    if (!quiz) {
      if (
        document.status === DocumentStatus.UPLOADED ||
        document.status === DocumentStatus.PROBING ||
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
          retryable: isDocumentProcessingFailureRetryable(document.errorCode),
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

  async retry(ownerId: string, id: string): Promise<Document> {
    const document = await this.contentRepository.findByOwnerId(ownerId, id);
    if (!document) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: `Document ${id} not found`,
      });
    }
    if (document.status === DocumentStatus.PROBING) {
      return document;
    }
    if (document.status !== DocumentStatus.FAILED) {
      throw new ConflictException({
        code: 'DOCUMENT_RETRY_NOT_ALLOWED',
        message: document.status === DocumentStatus.PROCESSING
          ? 'Document processing is already in progress.'
          : 'Document cannot be retried in its current state.',
        retryable: document.status === DocumentStatus.PROCESSING,
      });
    }
    if (!isDocumentProcessingFailureRetryable(document.errorCode)) {
      throw new ConflictException({
        code: 'DOCUMENT_RETRY_NOT_ALLOWED',
        message: 'This Document failure requires a new upload before processing can be retried.',
        retryable: false,
      });
    }
    return this.verifyAndStartProcessing(ownerId, id, document, 'RETRY');
  }

  /**
   * Confirm upload xong: text/document files are verified immediately. Media
   * files enter PROBING so the isolated probe worker can capture the exact
   * version before any processing credit is reserved.
   */
  async confirm(
    ownerId: string,
    id: string,
    options: { readonly rightsConfirmed?: boolean } = {},
  ): Promise<Document> {
    const document = await this.contentRepository.findByOwnerId(ownerId, id);
    if (!document) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: `Document ${id} not found`,
      });
    }
    if (
      document.status === DocumentStatus.FAILED &&
      !isDocumentProcessingFailureRetryable(document.errorCode)
    ) {
      throw new ConflictException({
        code: 'DOCUMENT_RETRY_NOT_ALLOWED',
        message: 'This Document failure requires a new upload before processing can be retried.',
        retryable: false,
      });
    }

    return this.verifyAndStartProcessing(ownerId, id, document, 'CONFIRM', options.rightsConfirmed === true);
  }

  private async verifyAndStartProcessing(
    ownerId: string,
    id: string,
    document: Document,
    mode: ProcessingStartMode,
    rightsConfirmed = false,
  ): Promise<Document> {
    if (document.status === DocumentStatus.DELETING) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: `Document ${id} not found`,
      });
    }
    const policy = resolveDocumentUploadPolicy(document.type, document.originalName);
    if (policy.bucket === 'media' && document.modelSelectionKind === 'CUSTOM') {
      throw this.mediaRequiresPlatformModel();
    }
    const declaredSizeBytes = Number(document.sizeBytes);
    assertDocumentUploadSize(policy, declaredSizeBytes);
    if (
      document.status === DocumentStatus.PROBING ||
      document.status === DocumentStatus.PROCESSING ||
      document.status === DocumentStatus.READY
    ) {
      return document;
    }

    const mediaBucket = policy.bucket === 'media'
      ? this.storage.getBucketName('media')
      : undefined;
    if (
      mediaBucket &&
      document.status === DocumentStatus.FAILED &&
      this.getPersistedMediaSourceLocator(document, mediaBucket) === null
    ) {
      // Without a first-claim locator, retrying could probe a replaced object.
      throw this.mediaSourceIdentityUnavailable();
    }
    const isSubtitleDocument = document.type === DocumentType.YOUTUBE;
    if (isSubtitleDocument && mode === 'CONFIRM' && !rightsConfirmed) {
      throw this.subtitleRightsRequired();
    }
    // A subtitle Document is validated by its parsed snapshot; the raw object has no magic bytes to verify.
    if (!mediaBucket && !isSubtitleDocument) {
      const v = await this.verifier.verify(document.storageRef, document.type, policy.bucket);
      if (
        !v.exists ||
        v.sizeBytes !== declaredSizeBytes ||
        v.contentValidation === 'INVALID'
      ) {
        throw new BadRequestException('Uploaded file failed verification');
      }
    }

    const selection: DocumentModelSelection = {
      customModelConfigId: document.customModelConfigId,
      kind: document.modelSelectionKind,
      platformModelId: document.platformModelId,
    };
    const confirmed = policy.bucket === 'media'
      ? await this.contentRepository.confirmMediaProbe(
        ownerId,
        id,
        selection,
        MEDIA_PROBE_POLICY_VERSION,
        mediaBucket!,
      )
      : await this.startTextProcessing(ownerId, id, selection, mode, isSubtitleDocument ? { rightsConfirmed } : undefined);
    if (!confirmed) {
      if (mode === 'CONFIRM') {
        throw new NotFoundException(`Document ${id} not found`);
      }
      throw new ConflictException({
        code: 'DOCUMENT_RETRY_CONFLICT',
        message: 'Document state changed before processing could be started. Please refresh and try again.',
        retryable: true,
      });
    }

    return confirmed;
  }

  /**
   * PDF/TXT start (ADR-0033): a Platform Model needs a wallet at the floor and queues text extraction; credits are
   * reserved from the real extracted text afterwards (return seam). A wallet below the floor maps to
   * 402 INSUFFICIENT_CREDITS and leaves the Document as is. Custom AI reserves nothing.
   */
  private async startTextProcessing(
    ownerId: string,
    id: string,
    selection: DocumentModelSelection,
    mode: ProcessingStartMode,
    subtitle?: { readonly rightsConfirmed: boolean },
  ): Promise<Document | null> {
    try {
      if (subtitle) {
        return await this.contentRepository.confirmSubtitleProcessing(ownerId, id, selection, {
          allowedStatuses: mode === 'RETRY'
            ? [DocumentStatus.FAILED]
            : [DocumentStatus.UPLOADED, DocumentStatus.FAILED],
          rightsConfirmed: subtitle.rightsConfirmed,
        });
      }
      return mode === 'RETRY'
        ? await this.contentRepository.retryProcessing(ownerId, id, selection)
        : await this.contentRepository.confirmProcessing(ownerId, id, selection);
    } catch (error) {
      if (error instanceof SubtitlePrerequisiteError) throw this.subtitlePrerequisiteFailed(error);
      if (!(error instanceof InsufficientCreditsError)) throw error;
      throw new HttpException({
        availableCredits: error.availableCredits,
        code: 'INSUFFICIENT_CREDITS',
        message: 'Not enough credits to process this Document with the selected platform model.',
        requiredCredits: error.requiredCredits,
        retryable: true,
        shortfallCredits: error.shortfallCredits,
      }, HttpStatus.PAYMENT_REQUIRED);
    }
  }

  private subtitleRightsRequired(): BadRequestException {
    return new BadRequestException({
      code: 'SUBTITLE_RIGHTS_CONFIRMATION_REQUIRED',
      message: 'Confirm that you have the right to use this video and subtitle before processing.',
      retryable: false,
    });
  }

  private subtitlePrerequisiteFailed(error: SubtitlePrerequisiteError): HttpException {
    if (error.prerequisite === 'RIGHTS_REQUIRED') return this.subtitleRightsRequired();
    return new ConflictException({
      code: 'SUBTITLE_PREVIEW_REQUIRED',
      message: 'Preview the subtitle before processing this Document.',
      retryable: false,
    });
  }

  private assertYoutubeLessonsEnabled(type: DocumentType): void {
    if (type === DocumentType.YOUTUBE && !this.config?.youtubeLessonsEnabled) {
      throw new ConflictException({
        code: 'YOUTUBE_LESSONS_DISABLED',
        message: 'YouTube lessons are not enabled.',
        retryable: false,
      });
    }
  }

  /** YOUTUBE needs a valid URL (only its video id is kept); every other type must not send one. */
  private resolveYoutubeVideoId(command: CreateUploadUrlCommand): string | null {
    if (command.type !== DocumentType.YOUTUBE) {
      if (command.youtubeUrl !== undefined) throw this.youtubeUrlInvalid();
      return null;
    }
    const videoId = command.youtubeUrl === undefined ? null : normalizeYoutubeVideoId(command.youtubeUrl);
    if (!videoId) throw this.youtubeUrlInvalid();
    return videoId;
  }

  private youtubeUrlInvalid(): BadRequestException {
    return new BadRequestException({
      code: 'YOUTUBE_URL_INVALID',
      message: 'The link is not a supported YouTube video URL.',
      retryable: false,
    });
  }

  /** D5 of #160: speech-to-text runs only on the platform model, never on an Owner-supplied endpoint. */
  private mediaRequiresPlatformModel(): BadRequestException {
    return new BadRequestException({
      code: 'MEDIA_REQUIRES_PLATFORM_MODEL',
      message: 'Audio and video Documents can only be processed with a platform model, not a custom model.',
      retryable: false,
    });
  }

  private assertMediaUploadsEnabled(bucketKind: 'documents' | 'media'): void {
    if (bucketKind === 'media' && !this.config?.storage.mediaEnabled) {
      throw new ConflictException({
        code: 'MEDIA_UPLOADS_DISABLED',
        message: 'Media uploads are not enabled until the media processing pipeline is available.',
        retryable: false,
      });
    }
  }
}
