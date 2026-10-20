import { describe, expect, it } from 'vitest';
import { sourceTreeUrl } from '$lib/shared/source';

describe('source tree URL', () => {
  it('links only immutable hexadecimal revisions', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expect(sourceTreeUrl('https://github.com/gaato/offkai-manager/', sha)).toBe(
      `https://github.com/gaato/offkai-manager/tree/${sha}`
    );
    expect(sourceTreeUrl('https://github.com/gaato/offkai-manager', 'development')).toBeNull();
    expect(sourceTreeUrl('', sha)).toBeNull();
  });
});
