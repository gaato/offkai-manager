import { randomBytes } from 'node:crypto';

/** Generates a 256-bit bearer token encoded as 64 lowercase hexadecimal characters. */
export function generateOrderAccessToken(): string {
  return randomBytes(32).toString('hex');
}
