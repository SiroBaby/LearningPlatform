import { Injectable, NotFoundException } from '@nestjs/common';

import type { CreateCustomModelConfigDto } from './dto/create-custom-model-config.dto';
import type { ModelCatalogItemDto } from './dto/model-catalog-item.dto';
import { canonicalizeCustomModelUrl } from './custom-model-url.validator';
import { OwnerModelConfigRepository } from './repositories/owner-model-config.repository';

@Injectable()
export class OwnerModelConfigService {
  constructor(private readonly configs: OwnerModelConfigRepository) {}

  async create(ownerId: string, dto: CreateCustomModelConfigDto): Promise<ModelCatalogItemDto> {
    const id = await this.configs.create({
      apiKey: dto.apiKey ?? '',
      baseUrl: canonicalizeCustomModelUrl(dto.baseUrl),
      capabilityVersion: dto.capabilityVersion,
      displayName: dto.displayName,
      model: dto.model,
      ownerId,
      structuredOutputMode: dto.structuredOutputMode,
      transport: dto.transport,
    });
    return { id, kind: 'CUSTOM', label: dto.displayName };
  }

  async revoke(ownerId: string, id: string): Promise<void> {
    if (!(await this.configs.revoke(ownerId, id))) {
      throw new NotFoundException(`Custom model ${id} not found`);
    }
  }
}
