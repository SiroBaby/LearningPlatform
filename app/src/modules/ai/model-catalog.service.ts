import { Inject, Injectable } from '@nestjs/common';

import { ApplicationConfigService } from '../../config/application-config.service';
import type {
  ModelCatalog,
  PlanModelCatalogItem,
  PublicModelCatalogItem,
} from './contracts/model-selection.contracts';
import type { OwnerModelConfigStore } from './contracts/model-selection.contracts';
import { OWNER_MODEL_CONFIGS } from './contracts/model-selection.contracts';
import { OWNER_ENTITLEMENTS, type OwnerEntitlements } from '../content/contracts/owner-entitlement.port';

@Injectable()
export class ModelCatalogService implements ModelCatalog {
  constructor(
    private readonly config: ApplicationConfigService,
    @Inject(OWNER_ENTITLEMENTS) private readonly entitlements: OwnerEntitlements,
    @Inject(OWNER_MODEL_CONFIGS) private readonly customModels: OwnerModelConfigStore,
  ) {}

  async listForOwner(ownerId: string): Promise<readonly PublicModelCatalogItem[]> {
    const plan = await this.entitlements.findOrCreate(ownerId, this.config.ai.plans.free.creditBalance);
    const platform = this.config.ai.platformModels
      .filter((model) => model.planIds.includes(plan.planId))
      .map((model) => ({ id: model.id, kind: 'PLAN' as const, label: model.label }));
    return [...platform, ...(await this.customModels.listForOwner(ownerId))];
  }

  async resolvePlan(ownerId: string, modelId: string): Promise<PlanModelCatalogItem | null> {
    const plan = await this.entitlements.findOrCreate(ownerId, this.config.ai.plans.free.creditBalance);
    const model = this.config.ai.platformModels.find(
      (candidate) => candidate.id === modelId && candidate.planIds.includes(plan.planId),
    );
    return model ?? null;
  }
}
