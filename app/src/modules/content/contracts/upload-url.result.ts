import { AutoMap } from '@automapper/classes';

export class UploadUrlResult {
  @AutoMap()
  documentId!: string;

  @AutoMap()
  expirySec!: number;

  @AutoMap()
  uploadUrl!: string;

  bucket!: string;
  objectKey!: string;
}
