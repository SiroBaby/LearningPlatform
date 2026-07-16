import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
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
}));
