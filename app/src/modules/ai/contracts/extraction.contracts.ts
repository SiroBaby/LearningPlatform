import { ProcessingJob } from '../entities/processing-job.entity';

export const DOCUMENT_SOURCE_READER = Symbol('DOCUMENT_SOURCE_READER');

export type Locator = PdfPageLocator | TextRangeLocator;

export interface PdfPageLocator {
  readonly kind: 'page';
  readonly page: number;
}

export interface TextRangeLocator {
  readonly kind: 'text-range';
  readonly start: number;
  readonly end: number;
}

export interface ExtractedSegment {
  readonly locator: Locator;
  readonly text: string;
}

export interface ExtractionSource {
  readonly storageRef: string;
  readonly type: 'PDF' | 'TEXT';
}

export interface DocumentSourceReader {
  read(job: ProcessingJob): Promise<ExtractionSource>;
}
