import {
  CreateBucketCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

/** Same pinned image as the local document E2E harness. */
const MINIO_IMAGE =
  'bitnamilegacy/minio@sha256:8343eea75f4f7ef6394e3e1f1a5447706bac719bf8b0731cbbf4c473f3050712';
const MINIO_PORT = 9000;
export const TEST_OBJECT_STORAGE_ROOT_USER = 'minioadmin';
export const TEST_OBJECT_STORAGE_ROOT_PASSWORD = 'minioadmin';
export const TEST_OBJECT_STORAGE_REGION = 'us-east-1';

export interface TestObjectVersions {
  readonly versionIds: readonly string[];
  readonly deleteMarkerCount: number;
}

export interface TestObjectStorage {
  readonly admin: S3Client;
  readonly host: string;
  readonly port: number;
  createBucket(bucket: string, versioning: 'Enabled' | 'Suspended' | 'Unversioned'): Promise<void>;
  /** Uploads bytes and returns the VersionId (undefined on an unversioned bucket). */
  putObject(bucket: string, key: string, body: string): Promise<string | undefined>;
  listVersions(bucket: string, key: string): Promise<TestObjectVersions>;
  /** Container log tail, for diagnosing storage failures in CI. */
  readLogs(): Promise<string>;
  stop(): Promise<void>;
}

/** Starts a real S3-compatible MinIO for integration tests. */
export async function startTestObjectStorage(): Promise<TestObjectStorage> {
  const container: StartedTestContainer = await new GenericContainer(MINIO_IMAGE)
    .withEnvironment({
      MINIO_ROOT_PASSWORD: TEST_OBJECT_STORAGE_ROOT_PASSWORD,
      MINIO_ROOT_USER: TEST_OBJECT_STORAGE_ROOT_USER,
    })
    .withCommand(['/opt/bitnami/scripts/minio/run.sh'])
    .withExposedPorts(MINIO_PORT)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', MINIO_PORT).forStatusCode(200))
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(MINIO_PORT);
  const admin = new S3Client({
    credentials: {
      accessKeyId: TEST_OBJECT_STORAGE_ROOT_USER,
      secretAccessKey: TEST_OBJECT_STORAGE_ROOT_PASSWORD,
    },
    endpoint: `http://${host}:${port}`,
    forcePathStyle: true,
    region: TEST_OBJECT_STORAGE_REGION,
  });

  return {
    admin,
    host,
    port,
    async createBucket(bucket, versioning) {
      await admin.send(new CreateBucketCommand({ Bucket: bucket }));
      if (versioning === 'Unversioned') return;
      await admin.send(new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' },
      }));
      if (versioning === 'Suspended') {
        await admin.send(new PutBucketVersioningCommand({
          Bucket: bucket,
          VersioningConfiguration: { Status: 'Suspended' },
        }));
      }
    },
    async putObject(bucket, key, body) {
      const response = await admin.send(new PutObjectCommand({ Body: body, Bucket: bucket, Key: key }));
      return response.VersionId;
    },
    async listVersions(bucket, key) {
      const response = await admin.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }));
      return {
        deleteMarkerCount: (response.DeleteMarkers ?? []).filter((marker) => marker.Key === key).length,
        versionIds: (response.Versions ?? [])
          .filter((version) => version.Key === key)
          .map((version) => version.VersionId ?? 'null'),
      };
    },
    async readLogs() {
      const chunks: string[] = [];
      const stream = await container.logs({ tail: 200 });
      await new Promise<void>((resolve) => {
        stream.on('data', (chunk: Buffer | string) => chunks.push(chunk.toString()));
        stream.on('end', () => resolve());
        setTimeout(() => {
          stream.destroy();
          resolve();
        }, 2_000);
      });
      return chunks.join('');
    },
    async stop() {
      admin.destroy();
      await container.stop();
    },
  };
}
