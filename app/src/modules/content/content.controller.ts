import { Body, Controller, Delete, Get, Header, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Mapper } from '@automapper/core';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/current-user.decorator';
import { MAPPER } from '../../common/mapping/mapper.provider';
import { UploadUrlResult } from './contracts/upload-url.result';
import { DocumentQuizResult } from './contracts/document-quiz.result';
import { DocumentEstimateResult } from './contracts/document-estimate.result';
import { ConfirmDocumentResponseDto } from './dto/confirm-document.response.dto';
import { ContentService } from './content.service';
import { SubtitlePreviewResult } from './contracts/subtitle-preview.result';
import { ConfirmDocumentDto } from './dto/confirm-document.dto';
import { SubtitlePreviewResponseDto } from './dto/subtitle-preview.response.dto';
import { SubtitlePreviewService } from './subtitles/subtitle-preview.service';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { DocumentResponseDto } from './dto/document.response.dto';
import { DocumentQuizResponseDto } from './dto/document-quiz.response.dto';
import { MediaPlaybackUrlResult } from './contracts/media-playback-url.result';
import { CreateMediaPlaybackUrlDto } from './dto/create-media-playback-url.dto';
import { MediaPlaybackUrlResponseDto } from './dto/media-playback-url.response.dto';
import { MEDIA_PLAYBACK_DEFAULT_REASON } from './contracts/media-playback-policy';
import { UploadUrlResponseDto } from './dto/upload-url.response.dto';
import { DocumentEstimateResponseDto } from '../ai/dto/document-estimate.response.dto';
import { Document } from './entities/document.entity';
import { CreateDocumentEstimateDto } from './dto/create-document-estimate.dto';
import { SessionAuthGuard } from '../auth/session-auth.guard';

@ApiBearerAuth()
@ApiTags('Documents')
@Controller('documents')
@UseGuards(SessionAuthGuard)
export class ContentController {
  constructor(
    private readonly content: ContentService,
    @Inject(MAPPER) private readonly mapper: Mapper,
    private readonly subtitlePreview: SubtitlePreviewService,
  ) {}

  @Post('upload-url')
  @ApiOperation({ summary: 'Create a presigned multipart upload form for a Document.' })
  @ApiBadRequestResponse({ description: 'Invalid request body or upload metadata.' })
  @ApiCreatedResponse({ type: UploadUrlResponseDto })
  async createUploadUrl(
    @CurrentUser() ownerId: string,
    @Body() dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponseDto> {
    const result = await this.content.createUploadUrl(ownerId, {
      originalName: dto.originalName,
      sizeBytes: dto.sizeBytes,
      type: dto.type,
      selection: {
        customModelConfigId: dto.customModelConfigId ?? null,
        kind: dto.modelSelectionKind,
        platformModelId: dto.platformModelId ?? null,
      },
      ...(dto.youtubeUrl === undefined ? {} : { youtubeUrl: dto.youtubeUrl }),
    });

    return this.mapper.map(result, UploadUrlResult, UploadUrlResponseDto);
  }

  @Post('estimate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Validate a model selection and return a coarse pre-upload estimate without creating a Document or reservation.' })
  @ApiBadRequestResponse({ description: 'Invalid file metadata or unavailable model selection.' })
  @ApiOkResponse({ type: DocumentEstimateResponseDto })
  async estimateBeforeUpload(
    @CurrentUser() ownerId: string,
    @Body() dto: CreateDocumentEstimateDto,
  ): Promise<DocumentEstimateResponseDto> {
    const result = await this.content.estimateBeforeUpload(ownerId, {
      sizeBytes: dto.sizeBytes,
      type: dto.type,
      selection: { customModelConfigId: dto.customModelConfigId ?? null, kind: dto.modelSelectionKind, platformModelId: dto.platformModelId ?? null },
    });
    return this.mapper.map(result, DocumentEstimateResult, DocumentEstimateResponseDto);
  }

  @Get()
  @ApiOperation({ summary: 'List Documents owned by the current Owner.' })
  @ApiOkResponse({ type: DocumentResponseDto, isArray: true })
  async listDocuments(@CurrentUser() ownerId: string): Promise<DocumentResponseDto[]> {
    const documents = await this.content.findAll(ownerId);
    return this.mapper.mapArray(documents, Document, DocumentResponseDto);
  }

  @Get(':id/quiz')
  @ApiOperation({ summary: 'Find the current Owner\'s Quiz for an owned Document.' })
  @ApiNotFoundResponse({ description: 'Document does not belong to the current Owner.' })
  @ApiConflictResponse({ description: 'Quiz is not ready or Document processing failed.' })
  @ApiInternalServerErrorResponse({ description: 'A READY Document has no persisted Quiz.' })
  @ApiOkResponse({ type: DocumentQuizResponseDto })
  async getDocumentQuiz(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) documentId: string,
  ): Promise<DocumentQuizResponseDto> {
    const result = await this.content.findQuiz(ownerId, documentId);
    return this.mapper.map(result, DocumentQuizResult, DocumentQuizResponseDto);
  }

  @Post(':id/playback-url')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Issue a short-lived streaming URL for an owned READY audio or video Document.' })
  @ApiOkResponse({ type: MediaPlaybackUrlResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid Document id or reason.' })
  @ApiNotFoundResponse({ description: 'Document does not belong to the current Owner or is being deleted.' })
  @ApiConflictResponse({ description: 'Document is not playable media, not READY, or its source identity is incomplete.' })
  @ApiServiceUnavailableResponse({ description: 'Media playback is disabled or the URL could not be signed.' })
  async createPlaybackUrl(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) documentId: string,
    @Body() dto: CreateMediaPlaybackUrlDto,
  ): Promise<MediaPlaybackUrlResponseDto> {
    const result = await this.content.createMediaPlaybackUrl({
      ownerId,
      documentId,
      reason: dto.reason ?? MEDIA_PLAYBACK_DEFAULT_REASON,
    });
    return this.mapper.map(result, MediaPlaybackUrlResult, MediaPlaybackUrlResponseDto);
  }

  @Post(':id/subtitle-preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Parse the uploaded subtitle of a YOUTUBE Document and return every cue for review.' })
  @ApiOkResponse({ type: SubtitlePreviewResponseDto })
  @ApiBadRequestResponse({ description: 'The subtitle cannot be read; the body carries a SUBTITLE_* code and optional line.' })
  @ApiNotFoundResponse({ description: 'Document does not belong to the current Owner.' })
  @ApiConflictResponse({ description: 'Document is not an UPLOADED YOUTUBE Document.' })
  async previewSubtitle(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SubtitlePreviewResponseDto> {
    const result = await this.subtitlePreview.preview(ownerId, id);
    return this.mapper.map(result, SubtitlePreviewResult, SubtitlePreviewResponseDto);
  }

  @Post(':id/confirm')
  @HttpCode(202)
  @ApiOperation({ summary: 'Verify an uploaded Document and enqueue processing.' })
  @ApiAcceptedResponse({ type: ConfirmDocumentResponseDto })
  @ApiBadRequestResponse({ description: 'Uploaded object is missing or fails validation, or rights are not confirmed for a YOUTUBE Document.' })
  @ApiNotFoundResponse({ description: 'Document does not belong to the current Owner.' })
  @ApiConflictResponse({ description: 'A YOUTUBE Document has no subtitle preview yet.' })
  async confirm(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto?: ConfirmDocumentDto,
  ): Promise<ConfirmDocumentResponseDto> {
    const document = await this.content.confirm(ownerId, id, { rightsConfirmed: dto?.rightsConfirmed });
    return this.mapper.map(document, Document, ConfirmDocumentResponseDto);
  }

  @Post(':id/retry')
  @HttpCode(202)
  @ApiOperation({ summary: 'Retry a retryable failed Document without re-uploading its source.' })
  @ApiAcceptedResponse({ type: ConfirmDocumentResponseDto })
  @ApiConflictResponse({ description: 'Document failure is terminal or processing is already in progress.' })
  @ApiNotFoundResponse({ description: 'Document does not belong to the current Owner.' })
  async retry(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConfirmDocumentResponseDto> {
    const document = await this.content.retry(ownerId, id);
    return this.mapper.map(document, Document, ConfirmDocumentResponseDto);
  }

  @Delete(':id')
  @HttpCode(202)
  @ApiOperation({ summary: 'Delete an owned Document and queue its physical purge.' })
  @ApiAcceptedResponse({ type: ConfirmDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'Document does not belong to the current Owner.' })
  async delete(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConfirmDocumentResponseDto> {
    const document = await this.content.delete(ownerId, id);
    return this.mapper.map(document, Document, ConfirmDocumentResponseDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a Document and its processing status.' })
  @ApiNotFoundResponse({ description: 'Document does not belong to the current Owner.' })
  @ApiOkResponse({ type: DocumentResponseDto })
  async getDocument(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DocumentResponseDto> {
    const doc = await this.content.findById(ownerId, id);
    if (!doc) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return this.mapper.map(doc, Document, DocumentResponseDto);
  }
}
