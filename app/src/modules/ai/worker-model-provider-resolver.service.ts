import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { CREDENTIAL_CIPHER, type CredentialCipher } from './contracts/credential-cipher.contract';
import type { CustomModelProvider } from './contracts/custom-model-provider.port';
import { OWNER_MODEL_CONFIGS, type OwnerModelConfigStore } from './contracts/model-selection.contracts';
import { createOpenAiCompatibleProvider } from './openai-llm-provider';
import { WORKER_EGRESS_VALIDATOR, type WorkerEgressValidator } from './contracts/worker-egress-validator.contract';
import type { LlmProvider } from './contracts/llm-provider.contracts';

@Injectable()
export class WorkerModelProviderResolver implements CustomModelProvider {
  constructor(
    @Inject(OWNER_MODEL_CONFIGS) private readonly configs: OwnerModelConfigStore,
    @Inject(CREDENTIAL_CIPHER) private readonly cipher: CredentialCipher,
    @Inject(WORKER_EGRESS_VALIDATOR) private readonly egress: WorkerEgressValidator,
  ) {}

  async resolve(ownerId: string, customModelConfigId: string): Promise<LlmProvider> {
    const config = await this.configs.findActiveForOwner(ownerId, customModelConfigId);
    if (!config) throw new NotFoundException('Custom model configuration is unavailable');
    const hostname = new URL(config.baseUrl).hostname;
    await this.egress.validateBeforeUnpinnedClientCreation(hostname);
    const apiKey = this.cipher.decrypt(config.apiKeyCiphertext);
    return createOpenAiCompatibleProvider({
      apiKey,
      baseUrl: config.baseUrl,
      capabilityVersion: config.capabilityVersion,
      model: config.model,
      structuredOutputMode: config.structuredOutputMode,
      transport: config.transport,
    });
  }
}
