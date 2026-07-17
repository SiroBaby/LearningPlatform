import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
  credentialEncryption: {
    key: process.env.AI_CREDENTIAL_ENCRYPTION_KEY,
    mode: process.env.AI_CREDENTIAL_ENCRYPTION_MODE ?? 'local',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    capabilityVersion: process.env.OPENAI_CAPABILITY_VERSION,
    model: process.env.OPENAI_MODEL,
    requestTimeoutMs: parseInt(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? '60000', 10),
    structuredOutputMode: process.env.OPENAI_STRUCTURED_OUTPUT_MODE,
    transport: process.env.OPENAI_TRANSPORT,
  },
  provider: process.env.AI_LLM_PROVIDER ?? 'fake',
  plans: {
    free: { creditBalance: parseInt(process.env.AI_FREE_CREDITS ?? '10000', 10) },
    paid: { creditBalance: parseInt(process.env.AI_PAID_CREDITS ?? '100000', 10) },
  },
  platformModels: [{
    creditPerInputToken: parseInt(process.env.AI_PLATFORM_INPUT_CREDITS_PER_TOKEN ?? '1', 10),
    creditPerOutputToken: parseInt(process.env.AI_PLATFORM_OUTPUT_CREDITS_PER_TOKEN ?? '2', 10),
    id: process.env.AI_PLATFORM_MODEL_ID ?? 'platform-default',
    label: process.env.AI_PLATFORM_MODEL_LABEL ?? 'Fast platform model',
    model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
    planIds: ['free', 'paid'],
  }],
}));
