import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
    requestTimeoutMs: parseInt(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? '60000', 10),
  },
  provider: process.env.AI_LLM_PROVIDER ?? 'fake',
}));
