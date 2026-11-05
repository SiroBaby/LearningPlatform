import type { PurgeObjectVersion } from './document-purge-storage.port';

export const MEDIA_ORPHAN_STORAGE = Symbol('MEDIA_ORPHAN_STORAGE');

export interface ListMediaObjectVersions {
  readonly bucket: string;
  readonly prefix: string;
  readonly maxKeys: number;
  readonly keyMarker?: string;
  readonly versionIdMarker?: string;
}

export interface MediaObjectVersion {
  readonly key: string;
  readonly versionId: string | undefined;
  readonly lastModified: Date | undefined;
}

/** One `ListObjectVersions` page. Delete markers are counted, never returned. */
export interface MediaObjectVersionPage {
  readonly versions: readonly MediaObjectVersion[];
  readonly deleteMarkerCount: number;
  readonly isTruncated: boolean;
}

/**
 * Storage capability of the orphan scanner. Failures surface as
 * `DocumentPurgeStorageError` with an already classified stable code.
 */
export interface MediaOrphanStorage {
  listObjectVersions(input: ListMediaObjectVersions): Promise<MediaObjectVersionPage>;
  /** Hard-deletes exactly one version; a version that is already gone counts as deleted. */
  deleteObjectVersion(target: PurgeObjectVersion): Promise<void>;
}
