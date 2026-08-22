import { DocumentType } from '../enums/document-type.enum';
import type { DocumentModelSelection } from '../../ai/contracts/model-selection.contracts';

export interface CreateUploadUrlCommand {
  originalName: string;
  sizeBytes: number;
  type: DocumentType;
  selection: DocumentModelSelection;
}
