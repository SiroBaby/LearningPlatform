import { Test } from '@nestjs/testing';
import { describe, expect, it } from '@jest/globals';

import { ExtractionService, PDF_JS_MODULE, PdfJsModule } from './extraction.service';

describe('ExtractionService Nest provider graph', () => {
  it('compiles with an explicit token for the external PDF.js module shape', async () => {
    const pdfjs: PdfJsModule = {
      getDocument: () => ({
        promise: Promise.reject(new Error('not used in DI test')),
        destroy: () => undefined,
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        ExtractionService,
        { provide: PDF_JS_MODULE, useValue: pdfjs },
      ],
    }).compile();

    expect(module.get(ExtractionService)).toBeInstanceOf(ExtractionService);
    expect(module.get(PDF_JS_MODULE)).toBe(pdfjs);

    await module.close();
  });
});
