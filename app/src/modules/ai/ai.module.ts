import { forwardRef, Module } from '@nestjs/common';

import { ContentModule } from '../content/content.module';
import { AssessmentModule } from '../assessment/assessment.module';

import { AiIngestionService } from './ai-ingestion.service';
import { AI_INGESTION } from './contracts/ai-ingestion.port';
import { JOB_PROCESSOR } from './contracts/job-processor.port';
import { JobPoller } from './job-poller.service';
import { ExtractionJobProcessor } from './extraction-job-processor.service';
import { ExtractionService, loadPdfJsModule, PDF_JS_MODULE } from './extraction.service';
import { AiOutboxRepository } from './repositories/ai-outbox.repository';
import { ProcessingJobRepository } from './repositories/processing-job.repository';
import { StuckJobDetector } from './stuck-job-detector.service';
import { ChunkService } from './chunk.service';
import { CHUNK_STORE } from './contracts/chunk.contracts';
import { ChunkRepository } from './repositories/chunk.repository';
import { GENERATION_CACHE } from './contracts/generation-cache.contracts';
import { PROMPT_VERSION_STORE } from './contracts/prompt-version.contracts';
import { QUIZ_GENERATOR } from './contracts/quiz-generator.port';
import { QuizGenerationService } from './quiz-generation.service';
import { GenerationCacheRepository } from './repositories/generation-cache.repository';
import { PromptVersionRepository } from './repositories/prompt-version.repository';
import { ModelCatalogController } from './model-catalog.controller';
import { ModelCatalogService } from './model-catalog.service';
import { OwnerModelConfigService } from './owner-model-config.service';
import { OwnerModelConfigRepository } from './repositories/owner-model-config.repository';
import { CREDENTIAL_CIPHER } from './contracts/credential-cipher.contract';
import { MODEL_CATALOG, OWNER_MODEL_CONFIGS } from './contracts/model-selection.contracts';
import { LocalCredentialCipher } from './local-credential-cipher';
import { ApplicationConfigService } from '../../config/application-config.service';
import { PROVIDER_USAGE } from './contracts/cost-guard.contracts';
import { ProviderUsageRepository } from './repositories/job-cost-guard.repository';
import { WorkerModelProviderResolver } from './worker-model-provider-resolver.service';
import { PROCESSING_JOB_MODEL_SELECTION } from './contracts/processing-job-model-selection.port';
import { PROCESSING_JOB_BUDGET } from './contracts/processing-job-budget.port';
import { ACCOUNT_ACCESS_REVOCATION } from './contracts/account-access-revocation.port';
import { WORKER_DNS_LOOKUP, WORKER_EGRESS_VALIDATOR } from './contracts/worker-egress-validator.contract';
import { lookup } from 'node:dns/promises';
import { UnpinnedClientDnsEgressValidator } from './worker-egress-validator.service';
import { CUSTOM_MODEL_PROVIDER } from './contracts/custom-model-provider.port';
import { InternalLeaseController } from './internal-lease.controller';
import { InternalLeaseGuard } from './internal-lease.guard';
import { LEASE_AUTHORITY } from './contracts/lease-authority.contract';
import { LeaseAuthorityService } from './lease-authority.service';
import { AuthModule } from '../auth/auth.module';
import { AI_OPERATIONAL_SNAPSHOT } from './contracts/ai-operational-snapshot.port';
import { AiOperationalSnapshotRepository } from './repositories/ai-operational-snapshot.repository';

@Module({
  imports: [AssessmentModule, forwardRef(() => ContentModule), AuthModule],
  controllers: [InternalLeaseController, ModelCatalogController],
  providers: [
    AiIngestionService,
    AiOutboxRepository,
    ChunkRepository,
    GenerationCacheRepository,
    PromptVersionRepository,
    OwnerModelConfigRepository,
    OwnerModelConfigService,
    ModelCatalogService,
    ProviderUsageRepository,
    WorkerModelProviderResolver,
    UnpinnedClientDnsEgressValidator,
    { provide: WORKER_DNS_LOOKUP, useValue: { lookup } },
    {
      provide: CREDENTIAL_CIPHER,
      inject: [ApplicationConfigService],
      useFactory: (config: ApplicationConfigService): { decrypt(ciphertext: string): string; encrypt(plaintext: string): string } => {
        const createCipher = (): LocalCredentialCipher => {
          const settings = config.ai.credentialEncryption;
          if (settings.mode === 'kms') throw new Error('KMS credential encryption is not configured');
          if (!settings.key) throw new Error('AI_CREDENTIAL_ENCRYPTION_KEY is required for local credential encryption');
          return new LocalCredentialCipher(Buffer.from(settings.key, 'base64'));
        };
        return { decrypt: (ciphertext: string): string => createCipher().decrypt(ciphertext), encrypt: (plaintext: string): string => createCipher().encrypt(plaintext) };
      },
    },
    ProcessingJobRepository,
    AiOperationalSnapshotRepository,
    { provide: AI_INGESTION, useExisting: AiIngestionService },
    { provide: ACCOUNT_ACCESS_REVOCATION, useExisting: ProcessingJobRepository },
    { provide: PDF_JS_MODULE, useFactory: loadPdfJsModule },
    ExtractionService,
    ChunkService,
    QuizGenerationService,
    ExtractionJobProcessor,
    { provide: JOB_PROCESSOR, useExisting: ExtractionJobProcessor },
    { provide: CHUNK_STORE, useExisting: ChunkRepository },
    { provide: GENERATION_CACHE, useExisting: GenerationCacheRepository },
    { provide: PROMPT_VERSION_STORE, useExisting: PromptVersionRepository },
    { provide: QUIZ_GENERATOR, useExisting: QuizGenerationService },
    { provide: OWNER_MODEL_CONFIGS, useExisting: OwnerModelConfigRepository },
    { provide: CUSTOM_MODEL_PROVIDER, useExisting: WorkerModelProviderResolver },
    { provide: MODEL_CATALOG, useExisting: ModelCatalogService },
    { provide: PROCESSING_JOB_MODEL_SELECTION, useExisting: ProcessingJobRepository },
    { provide: PROCESSING_JOB_BUDGET, useExisting: ProcessingJobRepository },
    { provide: WORKER_EGRESS_VALIDATOR, useExisting: UnpinnedClientDnsEgressValidator },
    { provide: PROVIDER_USAGE, useExisting: ProviderUsageRepository },
    { provide: AI_OPERATIONAL_SNAPSHOT, useExisting: AiOperationalSnapshotRepository },
    JobPoller,
    StuckJobDetector,
    InternalLeaseGuard,
    LeaseAuthorityService,
    { provide: LEASE_AUTHORITY, useExisting: LeaseAuthorityService },
  ],
  exports: [ACCOUNT_ACCESS_REVOCATION, AI_INGESTION, AI_OPERATIONAL_SNAPSHOT, AiOutboxRepository, JobPoller, MODEL_CATALOG, ProcessingJobRepository, StuckJobDetector],
})
export class AiModule {}
