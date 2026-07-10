import { DocumentType } from '../enums/document-type.enum';

export interface CreateUploadUrlCommand {
  originalName: string;
  sizeBytes: number;
  type: DocumentType;
}
