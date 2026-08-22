export const OWNER_ENTITLEMENTS = Symbol('OWNER_ENTITLEMENTS');

export interface OwnerEntitlements {
  findOrCreate(ownerId: string, initialCredits: number): Promise<{ readonly planId: string }>;
}
