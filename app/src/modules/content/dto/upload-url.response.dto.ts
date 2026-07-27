import { ApiProperty } from '@nestjs/swagger';
import { AutoMap } from '@automapper/classes';

export class UploadUrlResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly documentId: string;

  @ApiProperty({
    description: 'Short-lived presigned URL for direct upload to object storage.',
    example: 'http://localhost:9000/documents/...',
    format: 'uri',
  })
  @AutoMap()
  readonly uploadUrl: string;

  @ApiProperty({
    description: 'Signed multipart form fields. Submit these with the file to uploadUrl using HTTP POST.',
    example: { key: 'owner-id/document-id.pdf', policy: '...' },
  })
  @AutoMap()
  readonly uploadFields: Record<string, string>;

  @ApiProperty({ example: 300, minimum: 1 })
  @AutoMap()
  readonly expirySec: number;
}
