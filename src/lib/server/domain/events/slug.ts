import { randomBytes } from 'node:crypto';
import { formatDateCode } from '$lib/server/time';

const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateEventSlug(
  startsAt: Date,
  timeZone: string,
  bytes: Uint8Array = randomBytes(4)
): string {
  if (bytes.length < 4) throw new Error('event slug generation requires four random bytes');
  const suffix = Array.from(bytes.slice(0, 4), (byte) => alphabet[byte % alphabet.length]).join('');
  return `${formatDateCode(startsAt, timeZone)}-${suffix}`;
}
