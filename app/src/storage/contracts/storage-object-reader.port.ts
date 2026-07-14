export const STORAGE_OBJECT_READER = Symbol('STORAGE_OBJECT_READER');

export interface StorageObjectReader {
  read(objectKey: string, maxBytes: number): Promise<Buffer>;
}
