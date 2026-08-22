import { Inject, Injectable, Optional } from '@nestjs/common';

import { ApplicationConfigService } from '../../config/application-config.service';

import {
  ExtractedSegment,
  ExtractionSource,
} from './contracts/extraction.contracts';
import { ExtractionError } from './contracts/extraction-error';
import { DocumentProcessingFailureCode } from './contracts/document-processing-result';

export const MAX_EXTRACTABLE_OBJECT_BYTES = 20 * 1024 * 1024;

interface PdfTextItem {
  readonly hasEOL: boolean;
  readonly str: string;
}

interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
}

interface PdfDocument {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfLoadingTask {
  readonly promise: Promise<PdfDocument>;
  destroy(): void;
}

export interface PdfJsModule {
  getDocument(options: {
    data: Uint8Array;
    disableWorker: boolean;
    isEvalSupported: boolean;
    stopAtErrors: boolean;
    useSystemFonts: boolean;
  }): PdfLoadingTask;
}

export const PDF_JS_MODULE = Symbol('PDF_JS_MODULE');

export async function loadPdfJsModule(): Promise<PdfJsModule> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<PdfJsModule>;
  return dynamicImport('pdfjs-dist/legacy/build/pdf.mjs');
}

@Injectable()
export class ExtractionService {
  constructor(
    @Optional() private readonly config?: ApplicationConfigService,
    @Optional() @Inject(PDF_JS_MODULE)
    private readonly pdfjsOverride?: PdfJsModule,
  ) {}

  private get maxObjectBytes(): number {
    return this.config?.worker.maxExtractableObjectBytes ?? MAX_EXTRACTABLE_OBJECT_BYTES;
  }

  async extract(source: ExtractionSource, bytes: Buffer): Promise<ExtractedSegment[]> {
    if (bytes.length > this.maxObjectBytes) {
      throw new ExtractionError(DocumentProcessingFailureCode.EXTRACTION_OBJECT_TOO_LARGE);
    }
    if (source.type === 'TEXT') return this.extractPlainText(bytes);
    return this.extractPdf(bytes);
  }

  private extractPlainText(bytes: Buffer): ExtractedSegment[] {
    const text = bytes.toString('utf8');
    if (text.length === 0) return [];
    return [{ text, locator: { kind: 'text-range', start: 0, end: text.length } }];
  }

  private async extractPdf(bytes: Buffer): Promise<ExtractedSegment[]> {
    let task: PdfLoadingTask | undefined;
    let document: PdfDocument | undefined;
    try {
      const pdfjs = await this.loadPdfJs();
      task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        disableWorker: true,
        isEvalSupported: false,
        stopAtErrors: true,
        useSystemFonts: false,
      });
      document = await task.promise;
      const segments: ExtractedSegment[] = [];
      for (let page = 1; page <= document.numPages; page += 1) {
        const content = await document.getPage(page).then((value) => value.getTextContent());
        const text = this.toPageText(content.items);
        if (text) segments.push({ text, locator: { kind: 'page', page } });
      }
      if (segments.length === 0) {
        throw new ExtractionError(DocumentProcessingFailureCode.PDF_TEXT_NOT_FOUND);
      }
      return segments;
    } catch (error) {
      if (error instanceof ExtractionError) throw error;
      throw new ExtractionError(DocumentProcessingFailureCode.PDF_INVALID);
    } finally {
      await document?.destroy();
      task?.destroy();
    }
  }

  private toPageText(items: readonly PdfTextItem[]): string {
    return items
      .map((item) => item.str)
      .filter((text) => text.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async loadPdfJs(): Promise<PdfJsModule> {
    if (this.pdfjsOverride) return this.pdfjsOverride;
    return loadPdfJsModule();
  }
}
