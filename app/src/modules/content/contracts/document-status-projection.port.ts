import { DocumentStatus } from '../enums/document-status.enum';

export const DOCUMENT_STATUS_PROJECTION = Symbol('DOCUMENT_STATUS_PROJECTION');

export interface DocumentStatusProjection {
  project(command: DocumentStatusProjectionCommand): Promise<void>;
}

export interface DocumentStatusProjectionCommand {
  readonly documentId: string;
  readonly errorMessage: string | null;
  readonly ownerId: string;
  readonly status: DocumentStatus.READY | DocumentStatus.FAILED;
}
