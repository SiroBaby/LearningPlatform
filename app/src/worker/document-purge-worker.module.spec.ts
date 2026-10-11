import { describe, expect, it } from '@jest/globals';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { AiModule } from '../modules/ai/ai.module';
import { LlmProviderModule } from '../modules/ai/llm-provider.module';
import { ForwardRelay } from '../modules/content/forward-relay.service';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { DocumentPurgeRunner } from './document-purge-runner.service';
import { DocumentPurgeWorkerModule } from './document-purge-worker.module';
import { ReturnRelay } from './return-relay.service';
import { WorkerRunner } from './worker-runner.service';

describe('DocumentPurgeWorkerModule', () => {
  it('contains only the purge provider graph', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, DocumentPurgeWorkerModule) as readonly unknown[];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, DocumentPurgeWorkerModule) as readonly unknown[];

    expect(imports).not.toContain(AiModule);
    expect(imports).not.toContain(LlmProviderModule);
    // The API storage service would load the API credentials.
    expect(imports).not.toContain(StorageModule);
    expect(providers).not.toContain(StorageService);
    expect(providers).not.toContain(ForwardRelay);
    expect(providers).not.toContain(ReturnRelay);
    expect(providers).not.toContain(WorkerRunner);
    expect(providers).toContain(DocumentPurgeRunner);
  });
});
