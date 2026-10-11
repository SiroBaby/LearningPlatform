import {
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { HttpsProxyAgent } from 'https-proxy-agent';

import type { DocumentPurgeStorageConnection } from '../config/configuration.types';
import {
  DocumentPurgeStorage,
  DocumentPurgeStorageError,
  PurgeObject,
  PurgeObjectVersion,
} from '../modules/content/contracts/document-purge-storage.port';
import { BucketVersioningState } from '../modules/content/enums/bucket-versioning-state.enum';
import { DocumentPurgeErrorCode } from '../modules/content/enums/document-purge-error-code.enum';

/** The purge worker owns retry timing; the SDK must not retry on its own. */
const SDK_MAX_ATTEMPTS = 1;
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
const HTTP_STATUS_SERVER_ERROR_MIN = 500;
const HTTP_STATUS_CLIENT_ERROR_MIN = 400;

const ALREADY_DELETED_S3_CODES = new Set(['NoSuchKey', 'NoSuchVersion']);
const ACCESS_DENIED_S3_CODES = new Set([
  'AccessDenied',
  'AllAccessDisabled',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
]);
const CONFIGURATION_S3_CODES = new Set([
  'AuthorizationHeaderMalformed',
  'InvalidArgument',
  'InvalidBucketName',
  'InvalidRequest',
  'NoSuchBucket',
  'PermanentRedirect',
]);
const TEMPORARY_S3_CODES = new Set([
  'InternalError',
  'RequestTimeout',
  'RequestTimeTooSkewed',
  'ServiceUnavailable',
  'SlowDown',
  'ThrottlingException',
]);

/** Classification outcome: a stable failure code, or "nothing left to delete". */
export type PurgeStorageErrorClassification = DocumentPurgeErrorCode | 'ALREADY_DELETED';

interface SdkErrorShape {
  /** Set by the SDK only when the body was an S3 error document. */
  readonly Code?: unknown;
  readonly $metadata?: { readonly httpStatusCode?: unknown };
}

/**
 * Maps an SDK/network error to a stable code. Raw messages are dropped here
 * so they never reach the database, logs or outbox.
 */
export function classifyPurgeStorageError(error: unknown): PurgeStorageErrorClassification {
  const shape = (error && typeof error === 'object' ? error : {}) as SdkErrorShape;
  const s3Code = typeof shape.Code === 'string' && shape.Code !== '' ? shape.Code : undefined;
  const status = typeof shape.$metadata?.httpStatusCode === 'number'
    ? shape.$metadata.httpStatusCode
    : undefined;

  // No S3 error document: a proxy refusing the CONNECT tunnel (Squid's HTML
  // page makes the SDK throw a plain `Error`), a gateway page or a network
  // failure. It proves nothing about the object or the credential, so it is
  // never "already deleted" nor final; it is retried until the attempt cap.
  if (s3Code === undefined) return DocumentPurgeErrorCode.STORAGE_TEMPORARY;
  if (ALREADY_DELETED_S3_CODES.has(s3Code)) return 'ALREADY_DELETED';
  if (ACCESS_DENIED_S3_CODES.has(s3Code)) return DocumentPurgeErrorCode.ACCESS_DENIED;
  if (CONFIGURATION_S3_CODES.has(s3Code)) return DocumentPurgeErrorCode.CONFIGURATION;
  if (TEMPORARY_S3_CODES.has(s3Code)) return DocumentPurgeErrorCode.STORAGE_TEMPORARY;
  if (status === undefined) return DocumentPurgeErrorCode.STORAGE_TEMPORARY;
  if (status === HTTP_STATUS_TOO_MANY_REQUESTS || status >= HTTP_STATUS_SERVER_ERROR_MIN) {
    return DocumentPurgeErrorCode.STORAGE_TEMPORARY;
  }
  // An S3 error code we do not know, on a 4xx, means the request is wrong.
  if (status >= HTTP_STATUS_CLIENT_ERROR_MIN) return DocumentPurgeErrorCode.CONFIGURATION;
  return DocumentPurgeErrorCode.STORAGE_TEMPORARY;
}

/**
 * S3 client for the purge identity only. Every request goes through the
 * configured egress proxy to the exact configured host: no dualstack, no
 * transfer acceleration, fixed region.
 */
export function createDocumentPurgeS3Client(connection: DocumentPurgeStorageConnection): S3Client {
  const proxyAgent = connection.egressProxyUrl
    ? new HttpsProxyAgent(connection.egressProxyUrl)
    : undefined;
  return new S3Client({
    credentials: {
      accessKeyId: connection.accessKey,
      secretAccessKey: connection.secretKey,
    },
    endpoint: `${connection.useSSL ? 'https' : 'http'}://${connection.endpoint}:${connection.port}`,
    forcePathStyle: true,
    maxAttempts: SDK_MAX_ATTEMPTS,
    region: connection.region,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: connection.requestTimeoutMs,
      requestTimeout: connection.requestTimeoutMs,
      ...(proxyAgent ? { httpAgent: proxyAgent, httpsAgent: proxyAgent } : {}),
    }),
    useAccelerateEndpoint: false,
    useDualstackEndpoint: false,
  });
}

export class ObjectStorageDocumentPurger implements DocumentPurgeStorage {
  constructor(private readonly client: S3Client) {}

  async deleteObjectVersion(target: PurgeObjectVersion): Promise<void> {
    await this.send(() => this.client.send(new DeleteObjectCommand({
      Bucket: target.bucket,
      Key: target.key,
      VersionId: target.versionId,
    })));
  }

  async deleteObject(target: PurgeObject): Promise<void> {
    await this.send(() => this.client.send(new DeleteObjectCommand({
      Bucket: target.bucket,
      Key: target.key,
    })));
  }

  async getBucketVersioning(bucket: string): Promise<BucketVersioningState> {
    let status: string | undefined;
    try {
      status = (await this.client.send(new GetBucketVersioningCommand({ Bucket: bucket }))).Status;
    } catch (error) {
      const classification = classifyPurgeStorageError(error);
      throw new DocumentPurgeStorageError(
        classification === 'ALREADY_DELETED' ? DocumentPurgeErrorCode.CONFIGURATION : classification,
      );
    }
    if (status === 'Enabled') return BucketVersioningState.ENABLED;
    if (status === 'Suspended') return BucketVersioningState.SUSPENDED;
    return BucketVersioningState.UNVERSIONED;
  }

  private async send(request: () => Promise<unknown>): Promise<void> {
    try {
      await request();
    } catch (error) {
      const classification = classifyPurgeStorageError(error);
      if (classification === 'ALREADY_DELETED') return;
      throw new DocumentPurgeStorageError(classification);
    }
  }
}
