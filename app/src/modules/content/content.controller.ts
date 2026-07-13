import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Mapper } from '@automapper/core';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/current-user.decorator';
import { MAPPER } from '../../common/mapping/mapper.provider';
import { UploadUrlResult } from './contracts/upload-url.result';
import { ConfirmDocumentResponseDto } from './dto/confirm-document.response.dto';
import { ContentService } from './content.service';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { DocumentResponseDto } from './dto/document.response.dto';
import { UploadUrlResponseDto } from './dto/upload-url.response.dto';
import { Document } from './entities/document.entity';

@ApiSecurity('ownerId')
@ApiTags('Documents')
@Controller('documents')
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
    });

    return this.mapper.map(result, UploadUrlResult, UploadUrlResponseDto);
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
