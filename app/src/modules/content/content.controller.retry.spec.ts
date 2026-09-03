import { beforeEach, describe, expect, it } from '@jest/globals';
import type { Mapper } from '@automapper/core';

import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { Document } from './entities/document.entity';
import { DocumentStatus } from './enums/document-status.enum';

describe('ContentController.retry', () => {
  const ownerId = 'owner-1';
  const documentId = 'document-1';
  const response = { documentId, status: DocumentStatus.PROCESSING };
  let retryCalls: string[];
  let controller: ContentController;

  beforeEach(() => {
    retryCalls = [];
    const content = {
      retry: async (owner: string, id: string): Promise<Document> => {
        retryCalls.push(`${owner}:${id}`);
        return Object.assign(new Document(), { id, status: DocumentStatus.PROCESSING });
      },
    };
    const mapper = {
      map: (): typeof response => response,
    };
    controller = new ContentController(
      content as unknown as ContentService,
      mapper as unknown as Mapper,
    );
  });

  it('forwards the authenticated owner and maps the accepted response', async () => {
    await expect(controller.retry(ownerId, documentId)).resolves.toEqual(response);
    expect(retryCalls).toEqual(['owner-1:document-1']);
  });
});
