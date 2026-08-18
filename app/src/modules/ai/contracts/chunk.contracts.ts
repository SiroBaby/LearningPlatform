import type { Locator } from './extraction.contracts';

export interface ChunkCandidate {
  readonly chunkIndex: number;
  readonly contentHash: string;
  readonly id: string;
  readonly locator: Locator;
  readonly text: string;
}

export const CHUNK_STORE = Symbol('CHUNK_STORE');

export interface ChunkStore {
  replaceForDocument(input: ReplaceDocumentChunks): Promise<boolean>;
  findForDocument(documentId: string, ownerId: string): Promise<readonly ChunkRecord[]>;
}

export interface ReplaceDocumentChunks {
  readonly attempt: number;
  readonly documentId: string;
  readonly jobId: string;
  readonly leaseId: string;
  readonly ownerId: string;
  readonly chunks: readonly ChunkCandidate[];
}

export interface ChunkRecord extends ChunkCandidate {}
