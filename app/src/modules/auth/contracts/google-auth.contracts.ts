import type { AccountRole } from '../enums/account-role.enum';

export interface GoogleIdentity {
  readonly email: string;
  readonly emailVerified: true;
  readonly googleSub: string;
  readonly name?: string;
  readonly nonce: string;
}

export interface AuthSessionPair {
  readonly accessToken: string;
  readonly accessExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: string;
}

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly role: AccountRole;
  readonly status: string;
  readonly learningGoal?: string | null;
  readonly preferredLanguage?: string | null;
  readonly proficiencyLevel?: string | null;
  readonly onboardingCompletedAt?: string | null;
  readonly onboardingSkippedAt?: string | null;
}

export interface AuthProfileUpdate {
  readonly displayName?: string | null;
  readonly learningGoal?: string | null;
  readonly preferredLanguage?: 'vi' | 'en' | null;
  readonly proficiencyLevel?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | null;
  readonly onboardingAction?: 'complete' | 'skip' | 'reset';
}
