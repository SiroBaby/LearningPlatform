import { DeleteObjectCommand, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';

import {
  DocumentPurgeStorageError,
  PurgeObjectVersion,
} from '../modules/content/contracts/document-purge-storage.port';
import type {
  ListMediaObjectVersions,
  MediaObjectVersionPage,
  MediaOrphanStorage,
} from '../modules/content/contracts/media-orphan-storage.port';
import { DocumentPurgeErrorCode } from '../modules/content/enums/document-purge-error-code.enum';
import { classifyPurgeStorageError } from './object-storage-document-purger';

/**
 * S3 adapter of the orphan scanner. It shares the purge identity and client
 * (egress proxy, no dualstack, pinned region); listing versions additionally
 * needs `s3:ListBucketVersions`, documented in the purge runbook.
 */
export class ObjectStorageMediaOrphanStore implements MediaOrphanStorage {
  constructor(private readonly client: S3Client) {}

  async listObjectVersions(input: ListMediaObjectVersions): Promise<MediaObjectVersionPage> {
    try {
      const response = await this.client.send(new ListObjectVersionsCommand({
        Bucket: input.bucket,
        KeyMarker: input.keyMarker,
        MaxKeys: input.maxKeys,
        Prefix: input.prefix,
        VersionIdMarker: input.versionIdMarker,
      }));
      return {
        deleteMarkerCount: response.DeleteMarkers?.length ?? 0,
        isTruncated: response.IsTruncated === true,
        nextKeyMarker: response.NextKeyMarker,
        nextVersionIdMarker: response.NextVersionIdMarker,
        versions: (response.Versions ?? []).map((version) => ({
          key: version.Key ?? '',
          lastModified: version.LastModified,
          versionId: version.VersionId,
        })),
      };
    } catch (error) {
      const classification = classifyPurgeStorageError(error);
      // A missing key/version is not a meaningful answer to a listing request.
      throw new DocumentPurgeStorageError(
        classification === 'ALREADY_DELETED' ? DocumentPurgeErrorCode.CONFIGURATION : classification,
      );
    }
  }

  async deleteObjectVersion(target: PurgeObjectVersion): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: target.bucket,
        Key: target.key,
        VersionId: target.versionId,
      }));
    } catch (error) {
      const classification = classifyPurgeStorageError(error);
      if (classification === 'ALREADY_DELETED') return;
      throw new DocumentPurgeStorageError(classification);
    }
  }
}
