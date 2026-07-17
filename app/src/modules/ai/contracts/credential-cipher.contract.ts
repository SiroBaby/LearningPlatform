export const CREDENTIAL_CIPHER = Symbol('CREDENTIAL_CIPHER');

export interface CredentialCipher {
  decrypt(ciphertext: string): string;
  encrypt(plaintext: string): string;
}
