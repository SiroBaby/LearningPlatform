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
