/** Raised when a Platform Model confirm/retry cannot reserve its estimated credits (ADR-0022: 402 INSUFFICIENT_CREDITS). */
export class InsufficientCreditsError extends Error {
  constructor(
    readonly availableCredits: number,
    readonly requiredCredits: number,
  ) {
    super('Insufficient credits to start processing');
    this.name = 'InsufficientCreditsError';
  }

  get shortfallCredits(): number {
    return Math.max(0, this.requiredCredits - this.availableCredits);
  }
}
