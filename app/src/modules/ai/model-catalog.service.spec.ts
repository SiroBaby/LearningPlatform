import { describe, expect, it } from '@jest/globals';

import { ModelCatalogService } from './model-catalog.service';

describe('ModelCatalogService', () => {
  it('exposes configured platform labels rather than raw model IDs', async () => {
    const service = new ModelCatalogService(
      { ai: { plans: { free: { creditBalance: 100 }, paid: { creditBalance: 100 } }, platformModels: [{ creditPerInputToken: 1, creditPerOutputToken: 2, id: 'raw-model-id', label: 'Learner friendly label', model: 'model', planIds: ['free'] }] } } as never,
      { findOrCreate: async () => ({ planId: 'free' }) },
      { create: async () => 'unused', findActiveForOwner: async () => null, listForOwner: async () => [], revoke: async () => false },
    );

    expect(await service.listForOwner('owner-1')).toEqual([{ id: 'raw-model-id', kind: 'PLAN', label: 'Learner friendly label' }]);
  });

  it('does not resolve a paid platform model for a Free Owner', async () => {
    const service = new ModelCatalogService(
      { ai: { plans: { free: { creditBalance: 100 }, paid: { creditBalance: 100 } }, platformModels: [{ creditPerInputToken: 1, creditPerOutputToken: 2, id: 'paid-model', label: 'Paid model', model: 'model', planIds: ['paid'] }] } } as never,
      { findOrCreate: async () => ({ planId: 'free' }) },
      { create: async () => 'unused', findActiveForOwner: async () => null, listForOwner: async () => [], revoke: async () => false },
    );

    await expect(service.resolvePlan('owner-1', 'paid-model')).resolves.toBeNull();
  });
});
