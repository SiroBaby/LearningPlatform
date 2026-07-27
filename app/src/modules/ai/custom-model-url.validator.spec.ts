import { describe, expect, it } from '@jest/globals';

import { canonicalizeCustomModelUrl } from './custom-model-url.validator';

describe('canonicalizeCustomModelUrl', () => {
  it('accepts a public HTTPS URL and removes the trailing slash', () => {
    expect(canonicalizeCustomModelUrl('https://proxy.example.com/v1/')).toBe('https://proxy.example.com/v1');
  });

  it.each(['http://proxy.example.com', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://169.254.169.254/latest', 'https://user:pass@proxy.example.com/v1', 'https://proxy.example.com/v1?token=x', 'https://proxy.example.com/v1#part'])('rejects an unsafe custom model URL: %s', (url) => {
    expect(() => canonicalizeCustomModelUrl(url)).toThrow();
  });
});
