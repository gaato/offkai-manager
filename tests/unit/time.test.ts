import { describe, expect, it } from 'vitest';
import { formatCalendarDate } from '$lib/server/time';

describe('calendar date formatting', () => {
  it('preserves the PostgreSQL date in both locales', () => {
    expect(formatCalendarDate('2027-12-01', 'en')).toContain('2027');
    expect(formatCalendarDate('2027-12-01', 'ja')).toBe('2027年12月1日');
  });
});
