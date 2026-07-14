import { DocumentProcessingFailureCode } from './document-processing-result';

export class ExtractionError extends Error {
  constructor(readonly code: DocumentProcessingFailureCode) {
    super(code);
    this.name = ExtractionError.name;
  }
}
