import { ApiProperty } from '@nestjs/swagger';
import { AutoMap } from '@automapper/classes';

import { DocumentStatus } from '../enums/document-status.enum';
import { DocumentType } from '../enums/document-type.enum';

export class DocumentResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly id: string;

  @ApiProperty({ enum: DocumentType, enumName: 'DocumentType' })
  @AutoMap()
  readonly type: DocumentType;

  @ApiProperty({ example: 'bai-giang-cau-truc-du-lieu.pdf' })
  @AutoMap()
  readonly originalName: string;

  @ApiProperty({ example: 248320 })
  @AutoMap()
  readonly sizeBytes: number;

  @ApiProperty({ example: 'vi', nullable: true })
  @AutoMap()
  readonly language: string | null;

  @ApiProperty({ enum: DocumentStatus, example: DocumentStatus.READY })
  @AutoMap()
  readonly status: DocumentStatus;

  @ApiProperty({ nullable: true, example: null })
  @AutoMap()
  readonly durationSec: number | null;

  @ApiProperty({ nullable: true, example: 12 })
  @AutoMap()
  readonly pageCount: number | null;

  @ApiProperty({ nullable: true, example: null })
  @AutoMap()
  readonly errorMessage: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-06-21T12:34:56.789Z' })
  @AutoMap()
  readonly createdAt: string;

  @ApiProperty({ format: 'date-time', example: '2026-06-21T12:34:56.789Z' })
  @AutoMap()
  readonly updatedAt: string;
}
