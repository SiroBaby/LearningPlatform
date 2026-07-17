import type { LlmStructuredOutputMode, LlmTransport } from '../../../config/configuration.types';

export const MODEL_CATALOG = Symbol('MODEL_CATALOG');
export const OWNER_MODEL_CONFIGS = Symbol('OWNER_MODEL_CONFIGS');

export type ModelSelectionKind = 'PLAN' | 'CUSTOM';

export interface PlanModelCatalogItem {
  readonly creditPerInputToken: number;
  readonly creditPerOutputToken: number;
  readonly id: string;
  readonly model: string;
  readonly planIds: readonly string[];
}

export interface PublicModelCatalogItem {
  readonly id: string;
  readonly kind: ModelSelectionKind;
  readonly label: string;
}

export interface ModelCatalog {
  listForOwner(ownerId: string): Promise<readonly PublicModelCatalogItem[]>;
  resolvePlan(ownerId: string, modelId: string): Promise<PlanModelCatalogItem | null>;
}

export interface CustomModelConfiguration {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly capabilityVersion: string;
  readonly id: string;
  readonly model: string;
  readonly ownerId: string;
  readonly structuredOutputMode: LlmStructuredOutputMode;
  readonly transport: LlmTransport;
}

export interface EncryptedCustomModelConfiguration {
  readonly apiKeyCiphertext: string;
  readonly baseUrl: string;
  readonly capabilityVersion: string;
  readonly id: string;
  readonly model: string;
  readonly ownerId: string;
  readonly structuredOutputMode: LlmStructuredOutputMode;
  readonly transport: LlmTransport;
}

export interface OwnerModelConfigStore {
  create(input: Omit<CustomModelConfiguration, 'id'> & { readonly displayName: string }): Promise<string>;
  findActiveForOwner(ownerId: string, id: string): Promise<EncryptedCustomModelConfiguration | null>;
  listForOwner(ownerId: string): Promise<readonly PublicModelCatalogItem[]>;
  revoke(ownerId: string, id: string): Promise<boolean>;
}

export interface DocumentModelSelection {
  readonly customModelConfigId: string | null;
  readonly kind: ModelSelectionKind;
  readonly platformModelId: string | null;
}
