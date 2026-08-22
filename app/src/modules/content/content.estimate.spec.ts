import { describe, expect, it } from '@jest/globals';

import { ContentService } from './content.service';
import type { ModelCatalog } from '../ai/contracts/model-selection.contracts';

describe('ContentService.estimateBeforeUpload', () => {
  it('returns a pricing-aware coarse PLAN estimate without creating a Document or reserving credits', async () => {
    const catalog = new RecordingCatalog();
    const repository = { createUploaded: (): never => { throw new Error('Estimate must not create a document'); } };
    const service = new ContentService(repository as never, null as never, null as never, null as never, catalog);

    const result = await service.estimateBeforeUpload('owner-1', {
      sizeBytes: 2048,
      type: 'PDF',
      selection: { customModelConfigId: null, kind: 'PLAN', platformModelId: 'plan-model' },
    });

    expect(result).toEqual({ estimatedCredits: 1024, precision: 'COARSE', selectedModelKind: 'PLAN', selectedModelLabel: 'Configured plan label' });
    expect(catalog.resolvePlanOwners).toEqual(['owner-1']);
  });

  it('rejects a custom configuration outside the current Owner catalog', async () => {
    const catalog: ModelCatalog = {
      listForOwner: async () => [],
      resolvePlan: async () => null,
    };
    const service = new ContentService(null as never, null as never, null as never, null as never, catalog);

    await expect(service.estimateBeforeUpload('owner-1', {
      sizeBytes: 1024,
      type: 'PDF',
      selection: { customModelConfigId: 'foreign-config', kind: 'CUSTOM', platformModelId: null },
    })).rejects.toMatchObject({ status: 400 });
  });

  it('returns zero platform credits for an owned CUSTOM model', async () => {
    const catalog: ModelCatalog = {
      listForOwner: async () => [{ id: 'owned-config', kind: 'CUSTOM', label: 'Owner model' }],
      resolvePlan: async () => null,
    };
    const service = new ContentService(null as never, null as never, null as never, null as never, catalog);

    await expect(service.estimateBeforeUpload('owner-1', {
      sizeBytes: 2048,
      type: 'PDF',
      selection: { customModelConfigId: 'owned-config', kind: 'CUSTOM', platformModelId: null },
    })).resolves.toEqual({ estimatedCredits: 0, precision: 'COARSE', selectedModelKind: 'CUSTOM', selectedModelLabel: 'Owner model' });
  });
});

class RecordingCatalog implements ModelCatalog {
  readonly resolvePlanOwners: string[] = [];

  async listForOwner(): Promise<readonly { readonly id: string; readonly kind: 'PLAN'; readonly label: string }[]> {
    return [{ id: 'plan-model', kind: 'PLAN', label: 'Configured plan label' }];
  }

  async resolvePlan(ownerId: string): Promise<{ readonly creditPerInputToken: number; readonly creditPerOutputToken: number; readonly id: string; readonly model: string; readonly planIds: readonly string[] } | null> {
    this.resolvePlanOwners.push(ownerId);
    return { creditPerInputToken: 1, creditPerOutputToken: 2, id: 'plan-model', model: 'model', planIds: ['free'] };
  }
}
