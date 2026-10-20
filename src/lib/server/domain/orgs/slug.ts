import { randomInt } from 'node:crypto';

const MAX_SLUG_LENGTH = 64;
const RANDOM_SLUG_LENGTH = 7;
const RANDOM_SLUG_ATTEMPTS = 32;
const base36Alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function organizationSlugBase(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug;
}

export function randomOrganizationSlug(): string {
  return Array.from(
    { length: RANDOM_SLUG_LENGTH },
    () => base36Alphabet[randomInt(base36Alphabet.length)]
  ).join('');
}

export function availableOrganizationSlug(
  name: string,
  existingSlugs: ReadonlySet<string>,
  randomSlug: () => string = randomOrganizationSlug
): string {
  const base = organizationSlugBase(name);
  if (!base) {
    for (let attempt = 0; attempt < RANDOM_SLUG_ATTEMPTS; attempt += 1) {
      const candidate = randomSlug();
      if (!/^[a-z0-9]{6,8}$/.test(candidate)) {
        throw new Error('random organization slug must be 6 to 8 lowercase base36 characters');
      }
      if (!existingSlugs.has(candidate)) return candidate;
    }
    throw new Error('random organization slug collision limit reached');
  }
  if (!existingSlugs.has(base)) return base;
  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffixText.length).replace(/-+$/g, '')}${suffixText}`;
    if (!existingSlugs.has(candidate)) return candidate;
  }
  throw new Error('organization slug suffix space exhausted');
}
