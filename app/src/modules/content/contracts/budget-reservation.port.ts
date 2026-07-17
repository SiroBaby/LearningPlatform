export const BUDGET_RESERVATION = Symbol('BUDGET_RESERVATION');

export interface BudgetReservationPort {
  reserve(input: { readonly attempt: number; readonly estimatedCredits: number; readonly jobId: string; readonly ownerId: string }): Promise<void>;
  settle(input: { readonly attempt: number; readonly hasUncertainDispatch: boolean; readonly jobId: string; readonly knownActualCredits: number; readonly ownerId: string }): Promise<void>;
}
