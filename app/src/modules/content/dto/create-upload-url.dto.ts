import { IsEnum, IsInt, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { IsNonBlankString } from '../../../common/validators/is-non-blank-string.validator';
import { DocumentType } from '../enums/document-type.enum';

// Giới hạn size sơ bộ ở Phase 0 (1GB). Sau này siết theo plan (07/10-docs).
const MAX_SIZE_BYTES = 1024 * 1024 * 1024;

export class CreateUploadUrlDto {
  @ApiProperty({
    description: 'Original file name, used only as display metadata.',
    example: 'bai-giang-cau-truc-du-lieu.pdf',
    maxLength: 500,
  })
  @IsNonBlankString()
  @MaxLength(500)
  originalName!: string;

  @ApiProperty({
    description: 'Declared document type.',
    enum: DocumentType,
    enumName: 'DocumentType',
    example: DocumentType.PDF,
  })
  @IsEnum(DocumentType)
  type!: DocumentType;

  @ApiProperty({
    description: 'Declared file size in bytes. Maximum is 1 GB in Phase 0.',
    example: 248320,
    minimum: 1,
    maximum: MAX_SIZE_BYTES,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_SIZE_BYTES)
  sizeBytes!: number;
}
