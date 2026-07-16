import { Injectable, Inject } from '@nestjs/common';
import { createMap, forMember, mapFrom, Mapper } from '@automapper/core';

import { MAPPER } from '../../../common/mapping/mapper.provider';
import { DateTimeUtil } from '../../../common/datetime.util';
import { UploadUrlResult } from '../contracts/upload-url.result';
import { DocumentQuizResult } from '../contracts/document-quiz.result';
import { ConfirmDocumentResponseDto } from '../dto/confirm-document.response.dto';
import { DocumentResponseDto } from '../dto/document.response.dto';
import { DocumentQuizResponseDto } from '../dto/document-quiz.response.dto';
import { UploadUrlResponseDto } from '../dto/upload-url.response.dto';
import { Document } from '../entities/document.entity';

@Injectable()
export class ContentMappingProfile {
  constructor(@Inject(MAPPER) mapper: Mapper) {
    createMap(
      mapper,
      UploadUrlResult,
      UploadUrlResponseDto,
      forMember(
        (destination) => destination.uploadFields,
        mapFrom((source) => source.uploadFields),
      ),
    );
    createMap(mapper, DocumentQuizResult, DocumentQuizResponseDto);
    createMap(
      mapper,
      Document,
      ConfirmDocumentResponseDto,
      forMember(
        (destination) => destination.documentId,
        mapFrom((source) => source.id),
      ),
    );
    createMap(
      mapper,
      Document,
      DocumentResponseDto,
      forMember(
        (destination) => destination.language,
        mapFrom((source) => source.language ?? null),
      ),
      forMember(
        (destination) => destination.durationSec,
        mapFrom((source) => source.durationSec ?? null),
      ),
      forMember(
        (destination) => destination.pageCount,
        mapFrom((source) => source.pageCount ?? null),
      ),
      forMember(
        (destination) => destination.errorMessage,
        mapFrom((source) => source.errorMessage ?? null),
      ),
      forMember(
        (destination) => destination.createdAt,
        mapFrom((source) => DateTimeUtil.toUtcIsoString(source.createdAt)),
      ),
      forMember(
        (destination) => destination.updatedAt,
        mapFrom((source) => DateTimeUtil.toUtcIsoString(source.updatedAt)),
      ),
      forMember(
        (destination) => destination.sizeBytes,
        mapFrom((source) => Number(source.sizeBytes)),
      ),
    );
  }
}
