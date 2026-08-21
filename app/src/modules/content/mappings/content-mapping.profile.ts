import { Injectable, Inject } from '@nestjs/common';
import { createMap, forMember, mapFrom, Mapper } from '@automapper/core';

import { MAPPER } from '../../../common/mapping/mapper.provider';
import { DateTimeUtil } from '../../../common/datetime.util';
import { UploadUrlResult } from '../contracts/upload-url.result';
import { DocumentQuizResult } from '../contracts/document-quiz.result';
import { DocumentEstimateResult } from '../contracts/document-estimate.result';
import { ConfirmDocumentResponseDto } from '../dto/confirm-document.response.dto';
import { DocumentResponseDto } from '../dto/document.response.dto';
import { DocumentQuizResponseDto } from '../dto/document-quiz.response.dto';
import { UploadUrlResponseDto } from '../dto/upload-url.response.dto';
import { DocumentEstimateResponseDto } from '../../ai/dto/document-estimate.response.dto';
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
    createMap(mapper, DocumentEstimateResult, DocumentEstimateResponseDto);
    createMap(mapper, DocumentQuizResult, DocumentQuizResponseDto);
    createMap(
      mapper,
      Document,
      ConfirmDocumentResponseDto,
      forMember(
        (destination) => destination.documentId,
        mapFrom((source) => source.id),
      ),
      forMember(
        (destination) => destination.status,
        mapFrom((source) => source.status),
      ),
    );
    createMap(
      mapper,
      Document,
      DocumentResponseDto,
      forMember(
        (destination) => destination.status,
        mapFrom((source) => source.status),
      ),
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
        (destination) => destination.errorCode,
        mapFrom((source) => source.errorCode ?? null),
      ),
      forMember(
        (destination) => destination.selectedModelKind,
        mapFrom((source) => source.modelSelectionKind ?? null),
      ),
      forMember(
        (destination) => destination.selectedModelLabel,
        mapFrom((source) => source.selectedModelLabel ?? null),
      ),
      forMember(
        (destination) => destination.estimateStatus,
        mapFrom((source) => source.estimateStatus ?? null),
      ),
      forMember(
        (destination) => destination.estimatedCredits,
        mapFrom((source) => source.estimatedCredits == null ? null : Number(source.estimatedCredits)),
      ),
      forMember(
        (destination) => destination.settledCredits,
        mapFrom((source) => source.settledCredits == null ? null : Number(source.settledCredits)),
      ),
      forMember(
        (destination) => destination.budgetStatus,
        mapFrom((source) => source.budgetStatus ?? null),
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
