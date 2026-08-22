import { Global, Module } from '@nestjs/common';

import { ApplicationConfigModule } from '../../config/application-config.module';
import { ApplicationConfigService } from '../../config/application-config.service';
import { LLM_PROVIDER } from './contracts/llm-provider.contracts';
import { createLlmProvider } from './openai-llm-provider';

@Global()
@Module({
  imports: [ApplicationConfigModule],
  providers: [{
    provide: LLM_PROVIDER,
    inject: [ApplicationConfigService],
    useFactory: createLlmProvider,
  }],
  exports: [LLM_PROVIDER],
})
export class LlmProviderModule {}
