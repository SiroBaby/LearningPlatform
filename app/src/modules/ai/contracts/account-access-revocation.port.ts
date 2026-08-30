export const ACCOUNT_ACCESS_REVOCATION = Symbol('ACCOUNT_ACCESS_REVOCATION');

export type AccountAccessRevocationReason =
  | 'ACCOUNT_DELETED'
  | 'ACCOUNT_SUSPENDED';

export interface AccountAccessRevocation {
  apply(input: {
    readonly eventIdempotencyKey: string;
    readonly reasonCode: AccountAccessRevocationReason;
    readonly userId: string;
  }): Promise<void>;
}
