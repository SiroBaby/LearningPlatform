import { DocumentStatus } from '../enums/document-status.enum';
import { ApiProperty } from '@nestjs/swagger';
import { AutoMap } from '@automapper/classes';

export class ConfirmDocumentResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly documentId: string;

  @ApiProperty({ enum: DocumentStatus, example: DocumentStatus.PROCESSING })
  @AutoMap()
  readonly status: DocumentStatus;
}
