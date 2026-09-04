import 'reflect-metadata';

import { describe, expect, it } from '@jest/globals';

import { UploadUrlResponseDto } from './upload-url.response.dto';

type SwaggerPropertyMetadata = {
  readonly example?: Record<string, string>;
};

describe('UploadUrlResponseDto Swagger contract', () => {
  it('documents the AWS presigned POST field names', () => {
    const metadata = Reflect.getMetadata(
      'swagger/apiModelProperties',
      UploadUrlResponseDto.prototype,
      'uploadFields',
    ) as SwaggerPropertyMetadata;

    expect(metadata.example).toEqual(expect.objectContaining({
      bucket: 'documents',
      key: 'owner-id/document-id.pdf',
      'Content-Type': 'application/pdf',
      Policy: 'base64-encoded-policy',
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': 'ACCESS_KEY/20260904/us-east-1/s3/aws4_request',
      'X-Amz-Date': '20260904T000000Z',
      'X-Amz-Signature': 'hex-encoded-signature',
    }));
  });
});
