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
    example: {
      bucket: 'documents',
      key: 'owner-id/document-id.pdf',
      'Content-Type': 'application/pdf',
      Policy: 'base64-encoded-policy',
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': 'ACCESS_KEY/20260904/us-east-1/s3/aws4_request',
      'X-Amz-Date': '20260904T000000Z',
      'X-Amz-Signature': 'hex-encoded-signature',
    },
  })
  @AutoMap()
  readonly uploadFields: Record<string, string>;

  @ApiProperty({ example: 300, minimum: 1 })
  @AutoMap()
  readonly expirySec: number;
}
