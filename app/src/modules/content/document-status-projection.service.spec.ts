import { describe, expect, it, jest } from '@jest/globals';

import type { DocumentProbeCompletionCommand } from './contracts/document-status-projection.port';
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
