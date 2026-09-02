import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AiSettings,
  ApplicationSettings,
  CONFIG_PATH,
  DatabaseSslMode,
  DatabaseSettings,
  GoogleOAuthSettings,
  LlmProviderSettings,
  LlmCapabilityVersion,
  LlmStructuredOutputMode,
  LlmTransport,
  OpenAiGeneralSettings,
  StorageSettings,
  WorkerExecutionMode,
  WorkerSettings,
} from './configuration.types';

@Injectable()
export class ApplicationConfigService {
  constructor(private readonly config: ConfigService) {}

  get googleOAuth(): GoogleOAuthSettings {
    const googleOAuth = {
      clientId: this.required<string>(CONFIG_PATH.app.googleOAuth.clientId),
      clientSecret: this.required<string>(CONFIG_PATH.app.googleOAuth.clientSecret),
      redirectUri: this.required<string>(CONFIG_PATH.app.googleOAuth.redirectUri),
      encryptionKey: this.required<string>(CONFIG_PATH.app.googleOAuth.encryptionKey),
    };
    if (!/^https?:\/\//u.test(googleOAuth.redirectUri)) {
      throw new Error('GOOGLE_REDIRECT_URI must be an absolute HTTP(S) URL');
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(googleOAuth.encryptionKey)) {
      throw new Error('AUTH_OAUTH_ENCRYPTION_KEY must be base64 encoded');
    }
    const encryptionKeyBytes = Buffer.from(googleOAuth.encryptionKey, 'base64');
    if (encryptionKeyBytes.length !== 32) {
      throw new Error('AUTH_OAUTH_ENCRYPTION_KEY must decode to 32 bytes');
    }
    return googleOAuth;
  }

  get ai(): AiSettings {
    const provider = this.provider();
    const openai = this.openAiGeneral();
    const credentialEncryptionMode = this.config.get<string>(CONFIG_PATH.ai.credentialEncryption.mode) ?? 'local';
    if (credentialEncryptionMode !== 'local' && credentialEncryptionMode !== 'kms') {
      throw new Error('AI_CREDENTIAL_ENCRYPTION_MODE must be local or kms');
    }
    const credentialEncryption = {
      key: this.config.get<string>(CONFIG_PATH.ai.credentialEncryption.key),
      mode: credentialEncryptionMode,
    } as const;
    const platformModels = this.config.get<AiSettings['platformModels']>('ai.platformModels') ?? [{
      creditPerInputToken: 1,
      creditPerOutputToken: 2,
      id: 'platform-default',
      label: 'Fast platform model',
      model: openai.model ?? 'gpt-4.1-mini',
      planIds: ['free', 'paid'],
    }];
    if (platformModels.length === 0 || platformModels.some((model) => !model.id.trim() || !model.model.trim() || model.creditPerInputToken < 0 || model.creditPerOutputToken < 0)) {
      throw new Error('AI platform model catalog is invalid');
    }
    const plans = this.config.get<AiSettings['plans']>('ai.plans') ?? {
      free: { creditBalance: 10_000 },
      paid: { creditBalance: 100_000 },
    };
    if (!plans || !Number.isSafeInteger(plans.free.creditBalance) || plans.free.creditBalance < 0 || !Number.isSafeInteger(plans.paid.creditBalance) || plans.paid.creditBalance < 0) {
      throw new Error('AI plan configuration is invalid');
    }
    return {
      credentialEncryption,
      openai,
      provider,
      plans,
      platformModels,
    };
  }

  get llmProvider(): LlmProviderSettings {
    const provider = this.provider();
    if (this.required<string>(CONFIG_PATH.app.environment) === 'production' && provider !== 'openai') {
      throw new Error('AI_LLM_PROVIDER must be openai in production');
    }
    if (provider === 'fake') return { provider };

    const openai = this.openAiGeneral();
    if (
      !openai.apiKey?.trim() ||
      !openai.baseUrl?.trim() ||
      !openai.capabilityVersion?.trim() ||
      !openai.model?.trim() ||
      !openai.structuredOutputMode?.trim() ||
      !openai.transport?.trim()
    ) {
      throw new Error('OpenAI-compatible provider configuration is incomplete');
    }

    const capabilityVersion = this.openAiCapabilityVersion(openai.capabilityVersion);
    const transport = this.openAiTransport(openai.transport);
    if (
      (capabilityVersion === 'responses-json-v1' && transport !== 'responses') ||
      (capabilityVersion === 'chat-completions-json-v1' && transport !== 'chat-completions')
    ) {
      throw new Error('OPENAI_CAPABILITY_VERSION must match OPENAI_TRANSPORT');
    }

    return {
      openai: {
        apiKey: openai.apiKey,
        baseUrl: this.canonicalOpenAiBaseUrl(openai.baseUrl),
        capabilityVersion,
        model: openai.model,
        requestTimeoutMs: openai.requestTimeoutMs,
        structuredOutputMode: this.openAiStructuredOutputMode(openai.structuredOutputMode),
        transport,
      },
      provider,
    };
  }

  get application(): ApplicationSettings {
    const environment = this.required<string>(CONFIG_PATH.app.environment);
    const identityMode = this.config.get<string>(CONFIG_PATH.app.identityMode) ?? 'mtls';
    if (identityMode !== 'mtls' && identityMode !== 'stub') {
      throw new Error('IDENTITY_MODE must be mtls or stub');
    }
    if (identityMode === 'stub' && environment !== 'development' && environment !== 'test') {
      throw new Error('IDENTITY_MODE=stub is allowed only in development or test');
    }
    const externalApproval = {
      audience: this.config.get<string>(CONFIG_PATH.app.externalApproval.audience),
      issuer: this.config.get<string>(CONFIG_PATH.app.externalApproval.issuer),
      publicKey: this.config.get<string>(CONFIG_PATH.app.externalApproval.publicKey),
    };
    if (
      environment === 'production' &&
      (!externalApproval.audience?.trim() || !externalApproval.issuer?.trim() || !externalApproval.publicKey?.trim())
    ) {
      throw new Error(
        'AUTH_EXTERNAL_APPROVAL_PUBLIC_KEY, AUTH_EXTERNAL_APPROVAL_ISSUER, and AUTH_EXTERNAL_APPROVAL_AUDIENCE are required in production',
      );
    }
    const internalMtls = {
      caPath: this.config.get<string>(CONFIG_PATH.app.internalMtls.caPath),
      certPath: this.config.get<string>(CONFIG_PATH.app.internalMtls.certPath),
      expectedClientSpiffeUri: this.config.get<string>(CONFIG_PATH.app.internalMtls.expectedClientSpiffeUri),
      expectedWebBffSpiffeUri: this.config.get<string>(CONFIG_PATH.app.internalMtls.expectedWebBffSpiffeUri),
      keyPath: this.config.get<string>(CONFIG_PATH.app.internalMtls.keyPath),
      port: this.config.get<number>(CONFIG_PATH.app.internalMtls.port) ?? 3443,
    };
    const configuredPaths = [internalMtls.caPath, internalMtls.certPath, internalMtls.keyPath]
      .filter((value): value is string => Boolean(value?.trim()));
    if (configuredPaths.length !== 0 && configuredPaths.length !== 3) {
      throw new Error('INTERNAL_MTLS_CA_PATH, INTERNAL_MTLS_CERT_PATH, and INTERNAL_MTLS_KEY_PATH must be configured together');
    }
    const expectedSpiffeUri = /^spiffe:\/\/learning-platform\.local\/ns\/[a-z0-9]([-a-z0-9]*[a-z0-9])?\/sa\//u;
    if (
      configuredPaths.length === 3 &&
      (!new RegExp(`${expectedSpiffeUri.source}go-worker$`, 'u').test(internalMtls.expectedClientSpiffeUri ?? '') ||
        !new RegExp(`${expectedSpiffeUri.source}web-bff$`, 'u').test(internalMtls.expectedWebBffSpiffeUri ?? ''))
    ) {
      throw new Error('INTERNAL_MTLS_EXPECTED_CLIENT_SPIFFE_URI and INTERNAL_MTLS_EXPECTED_WEB_BFF_SPIFFE_URI must be valid SPIFFE URIs');
    }
    if (!Number.isInteger(internalMtls.port) || internalMtls.port < 1 || internalMtls.port > 65535) {
      throw new Error('INTERNAL_MTLS_PORT must be a valid TCP port');
    }
    return {
      authAdminGoogleSubs: this.authAdminGoogleSubs,
      environment,
      externalApproval,
      identityMode,
      internalMtls: { ...internalMtls, enabled: configuredPaths.length === 3 },
      port: this.required<number>(CONFIG_PATH.app.port),
      swagger: {
        enabled: this.required<boolean>(CONFIG_PATH.app.swagger.enabled),
        password: this.config.get<string>(CONFIG_PATH.app.swagger.password),
        username: this.config.get<string>(CONFIG_PATH.app.swagger.username),
      },
    };
  }

  get authAdminGoogleSubs(): readonly string[] {
    const raw = this.config.get<string | undefined>(CONFIG_PATH.app.authAdminGoogleSubs);
    if (!raw?.trim()) return [];
    const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
    if (values.some((value) => !/^[A-Za-z0-9._-]{1,255}$/u.test(value))) {
      throw new Error('AUTH_ADMIN_GOOGLE_SUBS must be a comma-separated Google subject allowlist');
    }
    return [...new Set(values)];
  }

  get database(): DatabaseSettings {
    const sslMode = this.databaseSslMode();
    let ssl: DatabaseSettings['ssl'];
    if (sslMode === 'disabled') {
      ssl = { mode: sslMode };
    } else {
      const ca = this.config.get<string>(CONFIG_PATH.database.ssl.ca);
      if (!ca?.trim()) {
        throw new Error('DB_SSL_CA must be a non-blank string when DB_SSL_MODE is verify-ca');
      }
      ssl = { ca, mode: sslMode };
    }
    if (this.required<string>(CONFIG_PATH.app.environment) === 'production' && sslMode === 'disabled') {
      throw new Error('DB_SSL_MODE must be verify-ca in production');
    }
    return {
      host: this.required<string>(CONFIG_PATH.database.host),
      name: this.required<string>(CONFIG_PATH.database.name),
      password: this.required<string>(CONFIG_PATH.database.password),
      port: this.required<number>(CONFIG_PATH.database.port),
      ssl,
      user: this.required<string>(CONFIG_PATH.database.user),
    };
  }

  get storage(): StorageSettings {
    const storage = {
      accessKey: this.required<string>(CONFIG_PATH.storage.accessKey),
      bucket: this.required<string>(CONFIG_PATH.storage.bucket),
      endpoint: this.required<string>(CONFIG_PATH.storage.endpoint),
      port: this.required<number>(CONFIG_PATH.storage.port),
      presignExpiry: this.required<number>(CONFIG_PATH.storage.presignExpiry),
      region: this.required<string>(CONFIG_PATH.storage.region),
      secretKey: this.required<string>(CONFIG_PATH.storage.secretKey),
      useSSL: this.required<boolean>(CONFIG_PATH.storage.useSSL),
    };
    this.assertProductionStorage(storage);
    return storage;
  }

  get worker(): WorkerSettings {
    const worker = {
      chunkInsertBatchSize: this.positiveInteger(CONFIG_PATH.worker.chunkInsertBatchSize),
      chunkMaxChars: this.positiveInteger(CONFIG_PATH.worker.chunkMaxChars),
      chunkOverlapChars: this.positiveInteger(CONFIG_PATH.worker.chunkOverlapChars),
      chunkTargetChars: this.positiveInteger(CONFIG_PATH.worker.chunkTargetChars),
      errorBackoffMs: this.positiveInteger(CONFIG_PATH.worker.errorBackoffMs),
      executionMode: this.workerExecutionMode(),
      healthHost: this.nonBlankString(CONFIG_PATH.worker.healthHost),
      healthPort: this.networkPort(CONFIG_PATH.worker.healthPort),
      maxExtractableObjectBytes: this.positiveInteger(
        CONFIG_PATH.worker.maxExtractableObjectBytes,
      ),
      maxChunksPerDocument: this.positiveInteger(CONFIG_PATH.worker.maxChunksPerDocument),
      maxChunkTotalChars: this.positiveInteger(CONFIG_PATH.worker.maxChunkTotalChars),
      jobBatchSize: this.positiveInteger(CONFIG_PATH.worker.jobBatchSize),
      outboxBatchSize: this.positiveInteger(CONFIG_PATH.worker.outboxBatchSize),
      pollIntervalMs: this.positiveInteger(CONFIG_PATH.worker.pollIntervalMs),
      quizGenerationConcurrency: this.positiveInteger(CONFIG_PATH.worker.quizGenerationConcurrency),
      stuckJobBatchSize: this.positiveInteger(CONFIG_PATH.worker.stuckJobBatchSize),
      stuckJobTimeoutMs: this.positiveInteger(CONFIG_PATH.worker.stuckJobTimeoutMs),
    };
    if (worker.chunkTargetChars > worker.chunkMaxChars) {
      throw new Error('WORKER_CHUNK_TARGET_CHARS must not exceed WORKER_CHUNK_MAX_CHARS');
    }
    if (worker.chunkOverlapChars >= worker.chunkMaxChars) {
      throw new Error('WORKER_CHUNK_OVERLAP_CHARS must be below WORKER_CHUNK_MAX_CHARS');
    }
    return worker;
  }

  private required<T>(path: string): T {
    const value = this.config.get<T>(path);
    if (value === undefined) {
      throw new Error(`Missing required configuration: ${path}`);
    }

    return value;
  }

  private provider(): AiSettings['provider'] {
    const provider = this.required<string>(CONFIG_PATH.ai.provider);
    if (provider !== 'fake' && provider !== 'openai') {
      throw new Error('AI_LLM_PROVIDER must be fake or openai');
    }
    return provider;
  }

  private databaseSslMode(): DatabaseSslMode {
    const mode = this.required<string>(CONFIG_PATH.database.ssl.mode);
    if (mode !== 'disabled' && mode !== 'verify-ca') {
      throw new Error('DB_SSL_MODE must be disabled or verify-ca');
    }
    return mode;
  }

  private workerExecutionMode(): WorkerExecutionMode {
    const executionMode = this.required<string>(CONFIG_PATH.worker.executionMode);
    if (executionMode !== 'legacy-processing' && executionMode !== 'relay-only') {
      throw new Error('WORKER_EXECUTION_MODE must be relay-only or legacy-processing');
    }
    return executionMode;
  }

  private openAiGeneral(): OpenAiGeneralSettings {
    return {
      apiKey: this.config.get<string>(CONFIG_PATH.ai.openai.apiKey),
      baseUrl: this.config.get<string>(CONFIG_PATH.ai.openai.baseUrl),
      capabilityVersion: this.config.get<string>(CONFIG_PATH.ai.openai.capabilityVersion),
      model: this.config.get<string>(CONFIG_PATH.ai.openai.model),
      requestTimeoutMs: this.positiveInteger(CONFIG_PATH.ai.openai.requestTimeoutMs),
      structuredOutputMode: this.config.get<string>(CONFIG_PATH.ai.openai.structuredOutputMode),
      transport: this.config.get<string>(CONFIG_PATH.ai.openai.transport),
    };
  }

  private canonicalOpenAiBaseUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('OPENAI_BASE_URL must be an absolute HTTP or HTTPS URL');
      }
      throw error;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('OPENAI_BASE_URL must be an absolute HTTP or HTTPS URL');
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(
        'OPENAI_BASE_URL must not contain credentials, query parameters, or a fragment',
      );
    }
    return url.toString().replace(/\/$/u, '');
  }

  private openAiStructuredOutputMode(value: string): LlmStructuredOutputMode {
    if (value !== 'json-object' && value !== 'json-schema-strict') {
      throw new Error(
        'OPENAI_STRUCTURED_OUTPUT_MODE must be json-schema-strict or json-object',
      );
    }
    return value;
  }

  private openAiCapabilityVersion(value: string): LlmCapabilityVersion {
    if (value !== 'chat-completions-json-v1' && value !== 'responses-json-v1') {
      throw new Error('OPENAI_CAPABILITY_VERSION must be responses-json-v1 or chat-completions-json-v1');
    }
    return value;
  }

  private openAiTransport(value: string): LlmTransport {
    if (value !== 'chat-completions' && value !== 'responses') {
      throw new Error('OPENAI_TRANSPORT must be responses or chat-completions');
    }
    return value;
  }

  private positiveInteger(path: string): number {
    const value = this.required<number>(path);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Configuration ${path} must be a positive integer`);
    }
    return value;
  }

  private networkPort(path: string): number {
    const value = this.required<number>(path);
    if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
      throw new Error(`Configuration ${path} must be a valid TCP port`);
    }
    return value;
  }

  private nonBlankString(path: string): string {
    const value = this.required<string>(path).trim();
    if (!value) {
      throw new Error(`Configuration ${path} must be a non-blank string`);
    }
    return value;
  }

  private assertProductionStorage(storage: StorageSettings): void {
    if (this.required<string>(CONFIG_PATH.app.environment) !== 'production') return;
    if (!storage.useSSL) {
      throw new Error('OBJECT_STORAGE_USE_SSL must be true in production');
    }
    if (
      storage.accessKey === 'minioadmin' ||
      storage.secretKey === 'minioadmin'
    ) {
      throw new Error('Default MinIO credentials are forbidden in production');
    }
  }
}
