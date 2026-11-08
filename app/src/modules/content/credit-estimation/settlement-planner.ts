import { isFailureBeforeProviderDispatch } from '../../ai/contracts/document-processing-result';
import type { DocumentProcessingFailureCode, DocumentProcessingUsage } from '../../ai/contracts/document-processing-result';
import type { PlanModelCatalogItem } from '../../ai/contracts/model-selection.contracts';
import type { DocumentSettlementPlan } from '../contracts/document-status-projection.port';
import { DocumentStatus } from '../enums/document-status.enum';
import { ModelPriceTableError } from './model-price-table';
import type { ActualCreditResult, MediaCreditEstimator } from './media-credit-estimator';

export type SettlementUnpricedReason = 'platform_model_not_configured' | 'price_missing';

export interface PlanReservationSettlementInput {
  readonly errorCode: DocumentProcessingFailureCode | null;
  readonly estimator: Pick<MediaCreditEstimator, 'calculateActual'>;
  /** Model the reservation was priced for (Document, or the job row when the Document is gone). */
  readonly platformModelId: string | null;
  readonly platformModels: readonly PlanModelCatalogItem[];
  readonly status: DocumentStatus;
  readonly usage: DocumentProcessingUsage | null;
}

export interface ReservationSettlementPlanning {
  /** Present only when the usage was priced; used for the `content.settlement.actual_usage` log. */
  readonly actual?: ActualCreditResult;
  readonly hasUncertainDispatch: boolean;
  readonly settlement: DocumentSettlementPlan;
  /** Set when usage existed but could not be priced; the plan is then HOLD everything. */
  readonly unpricedReason?: SettlementUnpricedReason;
}

/**
 * Pure decision of how to settle the reservation of a finished attempt (ADR-0022). Never throws for pricing
 * problems: an unpriced result is held instead of guessed.
 *  - usage reported: settle the actual credits; HELD when some provider dispatch has an unknown outcome;
 *  - usage absent (payload from an older worker): FAILED before any provider call releases everything,
 *    anything else may have spent credits unobserved and stays HELD.
 */
export function planReservationSettlement(input: PlanReservationSettlementInput): ReservationSettlementPlanning {
  const { usage } = input;
  if (!usage) {
    const isKnownUnspent = input.status === DocumentStatus.FAILED && isFailureBeforeProviderDispatch(input.errorCode);
    return holdPlan(!isKnownUnspent);
  }
  const hasUncertainDispatch = usage.uncertainDispatches > 0 || (usage.sttUncertainSeconds ?? 0) > 0;
  const model = input.platformModels.find((candidate) => candidate.id === input.platformModelId);
  const defaultModel = input.platformModels[0];
  if (!model || !defaultModel) {
    return { ...holdPlan(true), unpricedReason: 'platform_model_not_configured' };
  }
  try {
    const actual = input.estimator.calculateActual({ defaultModel, model, usage });
    return { actual, hasUncertainDispatch, settlement: { hasUncertainDispatch, knownActualCredits: actual.totalCredits } };
  } catch (error) {
    if (!(error instanceof ModelPriceTableError)) throw error;
    return { ...holdPlan(true), unpricedReason: 'price_missing' };
  }
}

function holdPlan(hasUncertainDispatch: boolean): ReservationSettlementPlanning {
  return { hasUncertainDispatch, settlement: { hasUncertainDispatch, knownActualCredits: 0 } };
}
