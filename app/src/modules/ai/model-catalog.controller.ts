import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/current-user.decorator';
import { ModelCatalogService } from './model-catalog.service';
import { OwnerModelConfigService } from './owner-model-config.service';
import { CreateCustomModelConfigDto } from './dto/create-custom-model-config.dto';
import { ModelCatalogItemDto } from './dto/model-catalog-item.dto';

@ApiSecurity('ownerId')
@ApiTags('AI models')
@Controller('ai/models')
export class ModelCatalogController {
  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly customModels: OwnerModelConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List models available to the current Owner without provider credentials.' })
  @ApiOkResponse({ type: ModelCatalogItemDto, isArray: true })
  async list(@CurrentUser() ownerId: string): Promise<readonly ModelCatalogItemDto[]> {
    return this.catalog.listForOwner(ownerId);
  }

  @Post('custom')
  @ApiOperation({ summary: 'Create an encrypted OpenAI-compatible custom model configuration.' })
  @ApiCreatedResponse({ type: ModelCatalogItemDto })
  async createCustom(@CurrentUser() ownerId: string, @Body() dto: CreateCustomModelConfigDto): Promise<ModelCatalogItemDto> {
    return this.customModels.create(ownerId, dto);
  }

  @Delete('custom/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke an owned custom model configuration.' })
  @ApiNoContentResponse()
  async revoke(@CurrentUser() ownerId: string, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.customModels.revoke(ownerId, id);
  }
}
