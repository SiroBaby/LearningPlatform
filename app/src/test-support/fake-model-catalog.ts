import type {
  ModelCatalog,
  PlanModelCatalogItem,
  PublicModelCatalogItem,
} from '../modules/ai/contracts/model-selection.contracts';

export const FAKE_PLAN_MODEL_ID = 'platform-default';
/** 1024 bytes -> 256 input tokens * 1 + 256 output tokens * 2. */
export const FAKE_PLAN_ESTIMATE_FOR_1024_BYTES = 768;

/** Catalog exposing one PLAN model priced 1 credit per input token and 2 per output token. */
export class FakeModelCatalog implements ModelCatalog {
  async listForOwner(): Promise<readonly PublicModelCatalogItem[]> {
    return [{ id: FAKE_PLAN_MODEL_ID, kind: 'PLAN', label: 'Platform default' }];
  }

  async resolvePlan(): Promise<PlanModelCatalogItem | null> {
    return {
      creditPerInputToken: 1,
      creditPerOutputToken: 2,
      id: FAKE_PLAN_MODEL_ID,
      model: 'fake-model',
      planIds: ['free'],
    };
  }
}
