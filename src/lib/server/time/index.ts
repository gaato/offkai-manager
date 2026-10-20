import { TZDate } from '@date-fns/tz';

export function assertTimeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(0);
    return zone;
  } catch {
    throw new Error(`OFFKAI_TIMEZONE must be a valid IANA time zone: ${zone}`);
  }
}

export function parseWallClock(value: string, zone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) {
    throw new Error('wall-clock value must use YYYY-MM-DDTHH:mm[:ss]');
  }

  const [, year, month, day, hour, minute, second = '0'] = match;
  return new TZDate(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    assertTimeZone(zone)
  );
}

export function formatWallClock(
  value: Date | number,
  locale: 'en' | 'ja',
  zone: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short'
  }
): string {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: assertTimeZone(zone)
  }).format(value);
}

export function formatWallClockInput(value: Date | number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: assertTimeZone(zone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function formatExportWallClock(value: Date | number, zone: string): string {
  return formatWallClockInput(value, zone).replace('T', ' ');
}

export function formatDateCode(value: Date | number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: assertTimeZone(zone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}${part('month')}${part('day')}`;
}

/** Formats a PostgreSQL date without allowing a host timezone to shift the calendar day. */
export function formatCalendarDate(value: string, locale: 'en' | 'ja'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('calendar date must use YYYY-MM-DD');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}
