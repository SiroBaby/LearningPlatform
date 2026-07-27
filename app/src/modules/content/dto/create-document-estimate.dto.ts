import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';

import { IsNonBlankString } from '../../../common/validators/is-non-blank-string.validator';
import { DocumentType } from '../enums/document-type.enum';

const MAX_SIZE_BYTES = 1024 * 1024 * 1024;

export class CreateDocumentEstimateDto {
  @ApiProperty({ description: 'Declared document type, validated using the same accepted document types as upload.', enum: DocumentType, example: DocumentType.PDF })
  @IsEnum(DocumentType)
  type!: DocumentType;

  @ApiProperty({ description: 'Declared file size used only for a coarse pre-upload estimate.', example: 248320, minimum: 1, maximum: MAX_SIZE_BYTES })
  @IsInt()
  @Min(1)
  @Max(MAX_SIZE_BYTES)
  sizeBytes!: number;

  @ApiProperty({ description: 'Select a platform PLAN model or an owner-managed CUSTOM model.', enum: ['PLAN', 'CUSTOM'], example: 'PLAN' })
  @IsEnum(['PLAN', 'CUSTOM'])
  modelSelectionKind!: 'PLAN' | 'CUSTOM';

  @ApiProperty({ description: 'Configured platform model available to the current Owner plan. Required for PLAN.', example: 'platform-default', nullable: true, required: false })
  @ValidateIf((dto: CreateDocumentEstimateDto) => dto.modelSelectionKind === 'PLAN')
  @IsNonBlankString()
  platformModelId?: string;

  @ApiProperty({ description: 'Current Owner custom model configuration. Required for CUSTOM.', format: 'uuid', nullable: true, required: false })
  @ValidateIf((dto: CreateDocumentEstimateDto) => dto.modelSelectionKind === 'CUSTOM')
  @IsUUID()
  customModelConfigId?: string;
}
