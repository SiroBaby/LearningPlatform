import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { ExtractionError } from './contracts/extraction-error';

export class BudgetExhaustedError extends ExtractionError {
  constructor() {
    super(DocumentProcessingFailureCode.BUDGET_EXHAUSTED);
    this.name = 'BudgetExhaustedError';
  }
}
