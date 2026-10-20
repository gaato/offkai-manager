import { describe, expect, it } from 'vitest';
import { deriveFieldKey } from '$lib/server/domain/events';

describe('registration form field keys', () => {
  it('derives stable normalized identifiers from equivalent labels', () => {
    expect(deriveFieldKey('  Dietary & Access Needs  ')).toBe('dietary_and_access_needs');
    expect(deriveFieldKey('Dietary   &   Access Needs')).toBe('dietary_and_access_needs');
    expect(deriveFieldKey('Ｘ　アカウント')).toBe('x_アカウント');
  });

  it('uses a stable fallback when a label has no letters or numbers', () => {
    expect(deriveFieldKey('***')).toBe('field');
    expect(deriveFieldKey(' *** ')).toBe('field');
  });
});
