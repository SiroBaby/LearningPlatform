import { describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';

import type {
  DocumentExtractionCompletionCommand,
  DocumentProbeCompletionCommand,
  DocumentStatusProjectionCommand,
} from './contracts/document-status-projection.port';
import { DocumentProcessingFailureCode } from '../ai/contracts/document-processing-result';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { MediaCreditEstimator } from './credit-estimation/media-credit-estimator';
import { DocumentStatusProjectionService } from './document-status-projection.service';

const inputModel = { creditPerInputToken: 1, creditPerOutputToken: 2, id: 'plan-model', model: 'gpt-5.4-mini', planIds: ['free'] };
const inputCommand = (durationSec: number): DocumentProbeCompletionCommand => ({
  deletionFence: 0,
  documentId: 'document-1',
  durationSec,
  eventCreatedAt: new Date(),
  fullPipelineJobId: 'job-1',
  locator: { bucket: 'media', contentLength: 24_451_261, etag: 'etag', key: 'media/key.mp4', versionId: 'v1' },
  ownerId: 'owner-1',
  policyVersion: 'media-v1',
  probeGeneration: 'generation-1',
  probeResultId: 'result-1',
});

const createService = (document: unknown, platformModels: readonly unknown[] = [inputModel]) => {
  const repository = {
    completeProbe: jest.fn<(command: unknown) => Promise<'APPLIED'>>().mockResolvedValue('APPLIED'),
    findByOwnerId: jest.fn<() => Promise<unknown>>().mockResolvedValue(document),
  };
  const config = { ai: { platformModels } };
  const service = new DocumentStatusProjectionService(repository as never, config as never, new MediaCreditEstimator());
  return { repository, service };
};

describe('DocumentStatusProjectionService.completeProbe', () => {
  it('reserves credits computed from the probed duration instead of the file size', async () => {
    const { repository, service } = createService({ modelSelectionKind: 'PLAN', platformModelId: 'plan-model', sizeBytes: 24_451_261, estimatedCredits: 6_113_328 });

    const actualOutcome = await service.completeProbe(inputCommand(355));

    expect(actualOutcome).toBe('APPLIED');
    expect(repository.completeProbe).toHaveBeenCalledWith(expect.objectContaining({
      creditEstimate: { kind: 'ESTIMATED', estimatedCredits: 17_474, platformModelId: 'plan-model' },
      durationSec: 355,
    }));
  });

  it('passes a zero estimate for a CUSTOM model document', async () => {
    const { repository, service } = createService({ modelSelectionKind: 'CUSTOM', platformModelId: null });

    await service.completeProbe(inputCommand(355));

    expect(repository.completeProbe).toHaveBeenCalledWith(expect.objectContaining({
      creditEstimate: { kind: 'ESTIMATED', estimatedCredits: 0, platformModelId: null },
    }));
  });

  it('passes a zero estimate when the document no longer exists so the repository ignores it', async () => {
    const { repository, service } = createService(null);

    await service.completeProbe(inputCommand(355));

    expect(repository.completeProbe).toHaveBeenCalledWith(expect.objectContaining({
      creditEstimate: { kind: 'ESTIMATED', estimatedCredits: 0, platformModelId: null },
    }));
  });

  it('returns a terminal MEDIA_PRICING_UNAVAILABLE failure instead of throwing when the platform model is no longer configured', async () => {
    const { repository, service } = createService({ modelSelectionKind: 'PLAN', platformModelId: 'removed-model' });

    await expect(service.completeProbe(inputCommand(60))).resolves.toBe('APPLIED');

    expect(repository.completeProbe).toHaveBeenCalledWith(expect.objectContaining({
      creditEstimate: { kind: 'UNAVAILABLE', errorCode: 'MEDIA_PRICING_UNAVAILABLE' },
    }));
  });

  it('returns MEDIA_PRICING_UNAVAILABLE when the platform model has no price', async () => {
    const { repository, service } = createService(
      { modelSelectionKind: 'PLAN', platformModelId: 'plan-model' },
      [{ ...inputModel, model: 'unpriced-model' }],
    );

    await service.completeProbe(inputCommand(60));

    expect(repository.completeProbe).toHaveBeenCalledWith(expect.objectContaining({
      creditEstimate: { kind: 'UNAVAILABLE', errorCode: 'MEDIA_PRICING_UNAVAILABLE' },
    }));
  });

  it.each([0, -5, 1.5, 7201])('returns MEDIA_PROBE_FAILED for an invalid duration of %s seconds', async (inputDuration) => {
    const { repository, service } = createService({ modelSelectionKind: 'PLAN', platformModelId: 'plan-model' });

    await service.completeProbe(inputCommand(inputDuration));

    expect(repository.completeProbe).toHaveBeenCalledWith(expect.objectContaining({
      creditEstimate: { kind: 'UNAVAILABLE', errorCode: 'MEDIA_PROBE_FAILED' },
    }));
  });

  it('prices STT against the first configured (default) model even when the Document selected another', async () => {
    const inputSelected = { ...inputModel, id: 'cheap-model', model: 'gpt-4.1-mini' };
    const { repository, service } = createService(
      { modelSelectionKind: 'PLAN', platformModelId: 'cheap-model' },
      [inputModel, inputSelected],
    );

    await service.completeProbe(inputCommand(355));

    expect(repository.completeProbe).toHaveBeenCalledWith(expect.objectContaining({
      creditEstimate: { kind: 'ESTIMATED', estimatedCredits: 17_474, platformModelId: 'cheap-model' },
    }));
  });
});

describe('DocumentStatusProjectionService.project settlement plan', () => {
  const platformDocument = { modelSelectionKind: 'PLAN', platformModelId: 'plan-model' };
  const inputProjection = (overrides: Partial<DocumentStatusProjectionCommand>): DocumentStatusProjectionCommand => ({
    attempt: 3,
    budgetStatus: null,
    documentId: 'document-1',
    errorCode: null,
    errorMessage: null,
    estimatedCredits: null,
    estimateStatus: null,
    eventCreatedAt: new Date(),
    jobId: 'job-1',
    leaseId: 'lease-1',
    ownerId: 'owner-1',
    settledCredits: null,
    status: DocumentStatus.READY,
    usage: null,
    ...overrides,
  });
  const createProjectionService = (document: unknown, platformModels: readonly unknown[] = [inputModel]) => {
    const repository = {
      findByOwnerId: jest.fn<() => Promise<unknown>>().mockResolvedValue(document),
      projectProcessingResult: jest.fn<(command: unknown) => Promise<'APPLIED'>>().mockResolvedValue('APPLIED'),
    };
    const service = new DocumentStatusProjectionService(repository as never, { ai: { platformModels } } as never, new MediaCreditEstimator());
    return { repository, service };
  };
  const llmUsage = (overrides: object = {}) => ({
    llm: [{ inputTokens: 300, model: 'gpt-5.4-mini', outputTokens: 50 }],
    sttBilledSeconds: null,
    sttUncertainSeconds: null,
    uncertainDispatches: 0,
    ...overrides,
  });

  it('settles the credits of the reported usage', async () => {
    const { repository, service } = createProjectionService(platformDocument);

    await service.project(inputProjection({ usage: llmUsage() }));

    expect(repository.projectProcessingResult).toHaveBeenCalledWith(expect.objectContaining({
      settlement: { hasUncertainDispatch: false, knownActualCredits: 400 },
    }));
  });

  it('adds the STT seconds with the estimate formula and holds when STT seconds are uncertain', async () => {
    const { repository, service } = createProjectionService(platformDocument);
    const expectedSttCredits = new MediaCreditEstimator().estimate({ defaultModel: inputModel, durationSeconds: 355, model: inputModel }).sttCredits;

    await service.project(inputProjection({ usage: llmUsage({ llm: [], sttBilledSeconds: 355, sttUncertainSeconds: 60 }) }));

    expect(repository.projectProcessingResult).toHaveBeenCalledWith(expect.objectContaining({
      settlement: { hasUncertainDispatch: true, knownActualCredits: expectedSttCredits },
    }));
  });

  it('plans nothing for a CUSTOM model document or an unknown document', async () => {
    const custom = createProjectionService({ modelSelectionKind: 'CUSTOM', platformModelId: null });
    const missing = createProjectionService(null);

    await custom.service.project(inputProjection({ usage: llmUsage() }));
    await missing.service.project(inputProjection({ usage: llmUsage() }));

    expect(custom.repository.projectProcessingResult).toHaveBeenCalledWith(expect.objectContaining({ settlement: null }));
    expect(missing.repository.projectProcessingResult).toHaveBeenCalledWith(expect.objectContaining({ settlement: null }));
  });

  it.each([
    ['READY', DocumentStatus.READY, null, true],
    ['FAILED before any provider call', DocumentStatus.FAILED, DocumentProcessingFailureCode.PDF_INVALID, false],
    ['FAILED with an unknown spend', DocumentStatus.FAILED, DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE, true],
  ])('without usage, %s => hasUncertainDispatch %s', async (_name, inputStatus, inputErrorCode, expectedUncertain) => {
    const { repository, service } = createProjectionService(platformDocument);

    await service.project(inputProjection({ errorCode: inputErrorCode, status: inputStatus as DocumentStatus.READY | DocumentStatus.FAILED }));

    expect(repository.projectProcessingResult).toHaveBeenCalledWith(expect.objectContaining({
      settlement: { hasUncertainDispatch: expectedUncertain, knownActualCredits: 0 },
    }));
  });

  it('logs the actual usage only after the projection was applied', async () => {
    const { repository, service } = createProjectionService(platformDocument);
    const logger = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    repository.projectProcessingResult.mockResolvedValueOnce('IGNORED' as never);

    await service.project(inputProjection({ usage: llmUsage() }));
    expect(logger).not.toHaveBeenCalled();
    await service.project(inputProjection({ usage: llmUsage() }));

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ event: 'content.settlement.actual_usage', jobId: 'job-1' }));
    logger.mockRestore();
  });

  it('holds instead of throwing when the Document model is no longer configured', async () => {
    const { repository, service } = createProjectionService({ modelSelectionKind: 'PLAN', platformModelId: 'removed-model' });

    await service.project(inputProjection({ usage: llmUsage() }));

    expect(repository.projectProcessingResult).toHaveBeenCalledWith(expect.objectContaining({
      settlement: { hasUncertainDispatch: true, knownActualCredits: 0 },
    }));
  });
});

describe('DocumentStatusProjectionService.completeExtraction timed transcript cap', () => {
  const inputExtraction = (chunkCount: number, extractedChars: number): DocumentExtractionCompletionCommand => ({
    chunkCount,
    deletionFence: 0,
    documentId: 'document-1',
    eventCreatedAt: new Date(),
    extractedChars,
    fullPipelineJobId: 'job-1',
    ownerId: 'owner-1',
    processingAttempt: 1,
  });
  const createExtractionService = (documentType: DocumentType) => {
    const repository = {
      completeExtraction: jest.fn<(command: unknown) => Promise<'APPLIED'>>().mockResolvedValue('APPLIED'),
      findByOwnerId: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        modelSelectionKind: 'PLAN',
        platformModelId: 'plan-model',
        type: documentType,
      }),
    };
    const service = new DocumentStatusProjectionService(
      repository as never,
      { ai: { platformModels: [inputModel] } } as never,
      new MediaCreditEstimator(),
    );
    return { repository, service };
  };

  it('prices at most 30 questions and the matching share of the text for a YOUTUBE Document', async () => {
    const { repository, service } = createExtractionService(DocumentType.YOUTUBE);

    await service.completeExtraction(inputExtraction(120, 120_000));

    // 30 calls over ceil(120000 * 30 / 120) = 30000 chars: 30*200 + 10000 input, 30*600 output.
    expect(repository.completeExtraction).toHaveBeenCalledWith(expect.objectContaining({
      creditEstimate: { kind: 'ESTIMATED', estimatedCredits: 16_000 + 36_000, platformModelId: 'plan-model' },
    }));
  });

  it('keeps the measured chunk count for a YOUTUBE Document at or below the cap', async () => {
    const { repository, service } = createExtractionService(DocumentType.YOUTUBE);

    await service.completeExtraction(inputExtraction(8, 9_000));

    // 8*200 + 3000 input, 8*600 output * 2.
    expect(repository.completeExtraction).toHaveBeenCalledWith(expect.objectContaining({
      creditEstimate: { kind: 'ESTIMATED', estimatedCredits: 4_600 + 9_600, platformModelId: 'plan-model' },
    }));
  });

  it('does not cap a TEXT Document', async () => {
    const { repository, service } = createExtractionService(DocumentType.TEXT);

    await service.completeExtraction(inputExtraction(120, 120_000));

    // 120*200 + 40000 input, 120*600 output * 2.
    expect(repository.completeExtraction).toHaveBeenCalledWith(expect.objectContaining({
      creditEstimate: { kind: 'ESTIMATED', estimatedCredits: 64_000 + 144_000, platformModelId: 'plan-model' },
    }));
  });
});
