import { AutoMap } from '@automapper/classes';

export class UploadUrlResult {
  @AutoMap()
  documentId!: string;

  @AutoMap()
  expirySec!: number;

  @AutoMap()
  uploadUrl!: string;

  @AutoMap()
  uploadFields!: Record<string, string>;

  bucket!: string;
  objectKey!: string;
}
