export const PROVIDER_USAGE = Symbol('PROVIDER_USAGE');

export interface ProviderUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
}

export interface ProviderUsageStore {
  recordUsage(input: {
    readonly attempt: number;
    readonly cached: boolean;
    readonly chargedCredits: number | null;
    readonly jobId: string;
    readonly ownerId: string;
    readonly providerIdentity: string;
    readonly requestKey: string;
    readonly usage: ProviderUsage;
  }): Promise<void>;
  summarizeUsage(input: {
    readonly attempt: number;
    readonly jobId: string;
    readonly ownerId: string;
  }): Promise<{ readonly hasUncertainDispatch: boolean; readonly knownActualCredits: number }>;
}
