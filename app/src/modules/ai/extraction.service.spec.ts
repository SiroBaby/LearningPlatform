import { describe, expect, it } from '@jest/globals';

import { ExtractionError } from './contracts/extraction-error';
import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { ExtractionService, MAX_EXTRACTABLE_OBJECT_BYTES, PdfJsModule } from './extraction.service';

describe('ExtractionService', () => {
  const extraction = new ExtractionService(undefined, createPdfJsMock());

  it('extracts one deterministic text segment with a zero-based range locator', async () => {
    const segments = await extraction.extract(
      { storageRef: 'documents/notes.txt', type: 'TEXT' },
      Buffer.from('hello\nworld'),
    );

    expect(segments).toEqual([
      { text: 'hello\nworld', locator: { kind: 'text-range', start: 0, end: 11 } },
    ]);
    expect(segments[0]).not.toHaveProperty('type');
  });

  it('extracts PDF text page-by-page with 1-based page locators', async () => {
    const segments = await extraction.extract(
      { storageRef: 'documents/lecture.pdf', type: 'PDF' },
      createPdf(['First page', 'Second page']),
    );

    expect(segments).toEqual([
      { text: 'First page', locator: { kind: 'page', page: 1 } },
      { text: 'Second page', locator: { kind: 'page', page: 2 } },
    ]);
    expect(segments[0]).not.toHaveProperty('type');
  });

  it('fails a scanned or empty PDF without attempting OCR', async () => {
    await expect(
      extraction.extract({ storageRef: 'documents/scan.pdf', type: 'PDF' }, createPdf([null])),
    ).rejects.toMatchObject({
      code: DocumentProcessingFailureCode.PDF_TEXT_NOT_FOUND,
    });
  });

  it('distinguishes an invalid PDF from a PDF with no text layer', async () => {
    await expect(
      extraction.extract({ storageRef: 'documents/bad.pdf', type: 'PDF' }, Buffer.from('not a PDF')),
    ).rejects.toMatchObject({
      code: DocumentProcessingFailureCode.PDF_INVALID,
    });
  });

  it('rejects an object above the extraction memory bound before parsing', async () => {
    await expect(
      extraction.extract(
        { storageRef: 'documents/large.txt', type: 'TEXT' },
        Buffer.alloc(MAX_EXTRACTABLE_OBJECT_BYTES + 1),
      ),
    ).rejects.toMatchObject({
      code: DocumentProcessingFailureCode.EXTRACTION_OBJECT_TOO_LARGE,
    });
  });
});

function createPdf(pageTexts: Array<string | null>): Buffer {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageTexts.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  for (const text of pageTexts) {
    const stream = text === null ? '' : `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
    const contentObject = objects.length + 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${offset.toString().padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function escapePdfText(value: string): string {
  return value.replace(/[\\()]/g, '\\$&');
}

function createPdfJsMock(): PdfJsModule {
  return {
    getDocument: ({ data }) => {
      const source = Buffer.from(data).toString('utf8');
      if (!source.startsWith('%PDF-')) throw new Error('invalid PDF');
      const pages = source.includes('First page')
        ? ['First page', 'Second page']
        : [null];
      return {
        promise: Promise.resolve({
          numPages: pages.length,
          getPage: async (pageNumber: number) => ({
            getTextContent: async () => ({
              items: pages[pageNumber - 1] ? [{ str: pages[pageNumber - 1]!, hasEOL: false }] : [],
            }),
          }),
          destroy: async () => undefined,
        }),
        destroy: () => undefined,
      };
    },
  };
}
