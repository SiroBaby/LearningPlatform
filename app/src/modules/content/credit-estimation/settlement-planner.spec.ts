import { describe, expect, it } from '@jest/globals';

import { DocumentProcessingFailureCode } from '../../ai/contracts/document-processing-result';
import { DocumentStatus } from '../enums/document-status.enum';
import { MediaCreditEstimator } from './media-credit-estimator';
import { planReservationSettlement } from './settlement-planner';

const PLATFORM_MODEL = { creditPerInputToken: 1, creditPerOutputToken: 2, id: 'platform-test', model: 'gpt-5.4-mini', planIds: ['free'] };
const estimator = new MediaCreditEstimator();

const baseInput = {
  errorCode: null,
  estimator,
  platformModelId: PLATFORM_MODEL.id,
  platformModels: [PLATFORM_MODEL],
  status: DocumentStatus.READY,
  usage: null,
};

describe('planReservationSettlement', () => {
  it('prices the reported usage and settles it', () => {
    const actualPlanning = planReservationSettlement({
      ...baseInput,
      usage: { llm: [{ inputTokens: 300, model: 'gpt-5.4-mini', outputTokens: 50 }], sttBilledSeconds: null, sttUncertainSeconds: null, uncertainDispatches: 0 },
    });

    expect(actualPlanning.settlement).toEqual({ hasUncertainDispatch: false, knownActualCredits: 400 });
    expect(actualPlanning.actual?.totalCredits).toBe(400);
  });

  it('holds the remainder when a dispatch has an unknown outcome', () => {
    const actualPlanning = planReservationSettlement({
      ...baseInput,
      usage: { llm: [], sttBilledSeconds: null, sttUncertainSeconds: 3, uncertainDispatches: 0 },
    });

    expect(actualPlanning.settlement.hasUncertainDispatch).toBe(true);
  });

  it('releases a FAILED result without usage only when it failed before any provider call', () => {
    const unspent = planReservationSettlement({
      ...baseInput, errorCode: DocumentProcessingFailureCode.PDF_INVALID, status: DocumentStatus.FAILED,
    });
    const unknown = planReservationSettlement({
      ...baseInput, errorCode: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE, status: DocumentStatus.FAILED,
    });

    expect(unspent.settlement).toEqual({ hasUncertainDispatch: false, knownActualCredits: 0 });
    expect(unknown.settlement).toEqual({ hasUncertainDispatch: true, knownActualCredits: 0 });
  });

  it('holds a READY result that has no usage', () => {
    expect(planReservationSettlement(baseInput).settlement).toEqual({ hasUncertainDispatch: true, knownActualCredits: 0 });
  });

  it('holds with a reason instead of guessing when the model is not configured or not priced', () => {
    const usage = { llm: [{ inputTokens: 1, model: 'unknown-model', outputTokens: 1 }], sttBilledSeconds: null, sttUncertainSeconds: null, uncertainDispatches: 0 };

    const notConfigured = planReservationSettlement({ ...baseInput, platformModelId: 'removed', usage });
    const notPriced = planReservationSettlement({ ...baseInput, platformModels: [{ ...PLATFORM_MODEL, model: 'unknown-model' }], usage });

    expect(notConfigured).toMatchObject({ settlement: { hasUncertainDispatch: true, knownActualCredits: 0 }, unpricedReason: 'platform_model_not_configured' });
    expect(notPriced).toMatchObject({ settlement: { hasUncertainDispatch: true, knownActualCredits: 0 }, unpricedReason: 'price_missing' });
  });
});
