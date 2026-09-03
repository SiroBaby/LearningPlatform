import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
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
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/current-user.decorator';
import { MAPPER } from '../../common/mapping/mapper.provider';
import { UploadUrlResult } from './contracts/upload-url.result';
import { DocumentQuizResult } from './contracts/document-quiz.result';
import { DocumentEstimateResult } from './contracts/document-estimate.result';
import { ConfirmDocumentResponseDto } from './dto/confirm-document.response.dto';
import { ContentService } from './content.service';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { DocumentResponseDto } from './dto/document.response.dto';
import { DocumentQuizResponseDto } from './dto/document-quiz.response.dto';
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

  @Post(':id/confirm')
  @HttpCode(202)
  @ApiOperation({ summary: 'Verify an uploaded Document and enqueue processing.' })
  @ApiAcceptedResponse({ type: ConfirmDocumentResponseDto })
  @ApiBadRequestResponse({ description: 'Uploaded object is missing or fails validation.' })
  @ApiNotFoundResponse({ description: 'Document does not belong to the current Owner.' })
  async confirm(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConfirmDocumentResponseDto> {
    const document = await this.content.confirm(ownerId, id);
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
